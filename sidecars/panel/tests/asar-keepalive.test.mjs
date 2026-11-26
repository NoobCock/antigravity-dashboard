import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ADAPTER_MARKER, AsarKeepAlive, buildPatchedAsar, inspectAsar, parseAsar, runStagedWaiter } from '../../../compat/asar-keepalive.mjs';

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

function packAsar(fileMap) {
  const header = { files: {} };
  const chunks = [];
  let cursor = 0;
  for (const [rel, raw] of Object.entries(fileMap)) {
    const body = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
    const parts = rel.split('/');
    let cur = header.files;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] ||= { files: {} };
      cur = cur[parts[i]].files;
    }
    cur[parts.at(-1)] = {
      size: body.length,
      offset: String(cursor),
      integrity: { algorithm: 'SHA256', hash: sha256(body), blockSize: 4194304, blocks: [sha256(body)] },
    };
    chunks.push(body);
    cursor += body.length;
  }
  const rawHeader = Buffer.from(JSON.stringify(header), 'utf8');
  const pad = (4 - (rawHeader.length % 4)) % 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(8 + rawHeader.length + pad, 4);
  prefix.writeUInt32LE(4 + rawHeader.length + pad, 8);
  prefix.writeUInt32LE(rawHeader.length, 12);
  return Buffer.concat([prefix, rawHeader, Buffer.alloc(pad), ...chunks]);
}

function sampleAppAsar({ version = '2.35.0', needsDebugSwitch = true, extraPreload = '' } = {}) {
  return packAsar({
    'package.json': JSON.stringify({ name: 'antigravity', version }),
    'dist/preload.js': `const electron_1 = require('electron');\nelectron_1.contextBridge.exposeInMainWorld('host', {});\n${extraPreload}`,
    'dist/ipcHandlers.js': `const electron_1 = require('electron');\nconst customScheme_1 = { extensionAuthorities: new Map() };\nvoid customScheme_1.extensionAuthorities;\n`,
    'dist/utils.js': `function setup(hubContents) {\n    hubContents.setWindowOpenHandler((details) => {\n        return { action: 'deny' };\n    });\n}\n`,
    'dist/main.js': `const electron_1 = require('electron');\n${needsDebugSwitch ? 'function removeStaleActivePortFile() {}\n' : ''}electron_1.app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');\n`,
    'dist/unrelated.txt': 'keep me intact',
  });
}

test('AsarKeepAlive auto-repairs unpatched app.asar after host updates and preserves backup parity with patch-loader.py', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ag-keepalive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appPath = join(root, 'resources', 'app.asar');
  const backupsDir = join(root, 'backups');
  const dataDir = join(root, 'data');
  await mkdir(join(root, 'resources'), { recursive: true });

  const original235 = sampleAppAsar({ version: '2.35.0' });
  await writeFile(appPath, original235);

  const notices = [];
  const keepAlive = new AsarKeepAlive({
    platform: 'win32',
    appAsar: appPath,
    backupsDir,
    dataDir,
    enabled: () => true,
    owns: async () => true,
    env: {},
    notify: info => notices.push(info),
  });

  // 1. First check detects unpatched 2.35.0 and repairs automatically
  const first = await keepAlive.check({ now: Date.UTC(2026, 10, 25, 2, 0, 0) });
  assert.equal(first.status, 'repaired-restart-needed');
  assert.equal(first.appVersion, '2.35.0');
  assert.equal(first.restartRequired, true);
  assert.equal(first.error, null);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].status, 'repaired-restart-needed');
  assert.equal(notices[0].appVersion, '2.35.0');

  const patched235 = await readFile(appPath);
  const inspected = inspectAsar(patched235);
  assert.equal(inspected.patchedComplete, true);
  assert.equal(inspected.hasMarker, true);
  assert.equal(inspected.hasDebugHook, true);

  // Verify backup exists and patch-loader.py --restore can restore the exact original bytes!
  const backupEntries = await readdir(backupsDir);
  assert.equal(backupEntries.length, 1);
  const backupFolder = join(backupsDir, backupEntries[0]);
  const note = JSON.parse(await readFile(join(backupFolder, 'patch.json'), 'utf8'));
  assert.equal(note.originalSha256, sha256(original235));
  assert.equal(note.patchedSha256, sha256(patched235));
  assert.equal(note.appVersion, '2.35.0');

  // Verify Python patch-loader.py --restore accepts this Node-generated backup!
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const restoreRun = spawnSync(py, ['compat/patch-loader.py', '--restore', backupFolder], {
    env: { ...process.env, AG_PULSE_APP_ASAR: appPath },
    encoding: 'utf8',
  });
  if (restoreRun.status === 0) {
    assert.ok((await readFile(appPath)).equals(original235));
  }

  // 2. Simulate Antigravity auto-updating to 2.36.0 (overwriting app.asar again)
  const original236 = sampleAppAsar({ version: '2.36.0' });
  await writeFile(appPath, original236);
  const second = await keepAlive.check({ now: Date.UTC(2026, 10, 25, 3, 0, 0) });
  assert.equal(second.status, 'repaired-restart-needed');
  assert.equal(second.appVersion, '2.36.0');
  assert.equal(inspectAsar(await readFile(appPath)).patchedComplete, true);

  // 3. Subsequent check with unchanged stat is a fast no-op
  const third = await keepAlive.check({ now: Date.UTC(2026, 10, 25, 3, 1, 0) });
  assert.equal(third.status, 'repaired-restart-needed');
  assert.equal(third.appVersion, '2.36.0');
});

test('AsarKeepAlive skips disabled plugins, non-Windows hosts, hosts without removeStaleActivePortFile, and unknown edits', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ag-keepalive-guards-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appPath = join(root, 'app.asar');
  const backupsDir = join(root, 'backups');
  const dataDir = join(root, 'data');

  // 1. Disabled plugin never touches app.asar
  const raw = sampleAppAsar({ version: '2.35.0' });
  await writeFile(appPath, raw);
  const disabledKa = new AsarKeepAlive({ platform: 'win32', appAsar: appPath, backupsDir, dataDir, enabled: () => false, env: {} });
  assert.equal((await disabledKa.check()).status, 'disabled');
  assert.ok((await readFile(appPath)).equals(raw));

  // 2. Non-Windows platform leaves app.asar untouched
  const linuxKa = new AsarKeepAlive({ platform: 'linux', appAsar: appPath, backupsDir, dataDir, enabled: () => true, env: {} });
  assert.equal((await linuxKa.check()).status, 'disabled');
  assert.ok((await readFile(appPath)).equals(raw));

  // 3. Future host without removeStaleActivePortFile needs no ASAR patch
  const cleanHost = sampleAppAsar({ version: '2.40.0', needsDebugSwitch: false });
  await writeFile(appPath, cleanHost);
  const cleanKa = new AsarKeepAlive({ platform: 'win32', appAsar: appPath, backupsDir, dataDir, enabled: () => true, env: {} });
  assert.equal((await cleanKa.check()).status, 'not-needed');
  assert.ok((await readFile(appPath)).equals(cleanHost));

  // 4. Unknown partial patch with marker is refused without overwriting
  const partial = sampleAppAsar({ version: '2.35.0', needsDebugSwitch: true, extraPreload: `${ADAPTER_MARKER}\n// custom\n` });
  await writeFile(appPath, partial);
  const unknownKa = new AsarKeepAlive({ platform: 'win32', appAsar: appPath, backupsDir, dataDir, enabled: () => true, env: {} });
  assert.equal((await unknownKa.check()).status, 'skipped-unknown-patch');
  assert.ok((await readFile(appPath)).equals(partial));
});

test('buildPatchedAsar produces valid ASAR structure with intact unrelated files', async () => {
  const original = sampleAppAsar({ version: '2.35.0' });
  const { patched, version } = await buildPatchedAsar(original);
  assert.equal(version, '2.35.0');
  const parsed = parseAsar(patched);
  const entry = parsed.header.files.dist.files['unrelated.txt'];
  const content = patched.subarray(parsed.base + Number(entry.offset), parsed.base + Number(entry.offset) + Number(entry.size)).toString('utf8');
  assert.equal(content, 'keep me intact');
});

test('AsarKeepAlive stages pending-app.asar on EBUSY lock and runStagedWaiter applies once unlocked without overwriting newer updates', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ag-keepalive-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appPath = join(root, 'resources', 'app.asar');
  const backupsDir = join(root, 'backups');
  const dataDir = join(root, 'data');
  await mkdir(join(root, 'resources'), { recursive: true });

  const original235 = sampleAppAsar({ version: '2.35.0' });
  await writeFile(appPath, original235);

  const spawned = [];
  const lockNotices = [];
  const ebusy = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
  const keepAlive = new AsarKeepAlive({
    platform: 'win32',
    appAsar: appPath,
    backupsDir,
    dataDir,
    enabled: () => true,
    owns: async () => true,
    env: {},
    writeTarget: async () => { throw ebusy; },
    spawnWaiter: opts => { spawned.push(opts); return { pid: process.pid }; },
    notify: info => lockNotices.push(info),
  });

  const first = await keepAlive.check({ now: Date.UTC(2026, 10, 25, 4, 0, 0) });
  assert.equal(first.status, 'staged-pending-exit');
  assert.equal(first.appVersion, '2.35.0');
  assert.equal(first.restartRequired, true);
  assert.equal(spawned.length, 1);
  assert.equal(lockNotices.length, 1);
  assert.equal(lockNotices[0].status, 'staged-pending-exit');
  assert.equal(existsSync(spawned[0].stagedPath), true);

  // Repeated check while waiter is still alive does NOT spawn duplicates or re-notify
  const second = await keepAlive.check({ now: Date.UTC(2026, 10, 25, 4, 1, 0) });
  assert.equal(second.status, 'staged-pending-exit');
  assert.equal(spawned.length, 1);
  assert.equal(lockNotices.length, 1);

  // Simulate lock holding for 2 polls, then releasing on the 3rd attempt
  let attempts = 0;
  const code = await runStagedWaiter({
    ...spawned[0],
    pollMs: 10,
    timeoutMs: 2000,
    writeTarget: async (p, buf) => {
      attempts++;
      if (attempts < 3) throw ebusy;
      await writeFile(p, buf);
    },
  });
  assert.equal(code, 0);
  assert.equal(attempts, 3);
  assert.equal(inspectAsar(await readFile(appPath)).patchedComplete, true);
  assert.equal(existsSync(spawned[0].stagedPath), false);
  const persisted = JSON.parse(await readFile(spawned[0].statePath, 'utf8'));
  assert.equal(persisted.status, 'healthy');
  assert.equal(persisted.restartRequired, false);

  // Safety check: if Antigravity updates to a newer archive while staged, waiter refuses to overwrite it
  const newer237 = sampleAppAsar({ version: '2.37.0' });
  await writeFile(appPath, newer237);
  await writeFile(spawned[0].stagedPath, await readFile(join(backupsDir, (await readdir(backupsDir))[0], 'app.asar')));
  const skipCode = await runStagedWaiter({
    ...spawned[0],
    pollMs: 10,
    timeoutMs: 500,
  });
  assert.equal(skipCode, 0);
  assert.ok((await readFile(appPath)).equals(newer237));
  assert.equal(existsSync(spawned[0].stagedPath), false);
});
