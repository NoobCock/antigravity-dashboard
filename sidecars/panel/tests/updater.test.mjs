import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { DashboardUpdater, compareVersions, crc32, extractZipEntries, parseSha256Text } from '../updater.mjs';

function buildZip(files, { method = 8 } = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const comp = method === 8 ? deflateRawSync(raw) : raw;
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, cd, eocd]);
}

function mockResponse(status, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: k => headers[k.toLowerCase()] ?? headers[k] ?? null },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

test('compareVersions handles semver, v-prefix and prereleases', () => {
  assert.equal(compareVersions('v0.9.0', '0.8.5'), 1);
  assert.equal(compareVersions('0.8.5', 'v0.9.0'), -1);
  assert.equal(compareVersions('0.9.0', 'v0.9.0'), 0);
  assert.equal(compareVersions('0.9.0', '0.9.0-rc.1'), 1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('not-a-version', '0.9.0'), null);
});

test('extractZipEntries validates deflate/stored entries, CRC32 and rejects traversal', () => {
  const zip = buildZip({
    'antigrative-dashboard/plugin.json': '{"name":"antigravity-pulse","version":"0.9.1"}',
    'antigrative-dashboard/compat/inline-widget.cjs': '// ok',
  }, { method: 8 });
  const entries = extractZipEntries(zip);
  assert.equal(entries.get('antigrative-dashboard/compat/inline-widget.cjs').toString('utf8'), '// ok');

  const stored = buildZip({ 'antigrative-dashboard/a.txt': 'hello' }, { method: 0 });
  assert.equal(extractZipEntries(stored).get('antigrative-dashboard/a.txt').toString('utf8'), 'hello');

  const evil = buildZip({ 'antigrative-dashboard/../escape.txt': 'nope' }, { method: 0 });
  assert.throws(() => extractZipEntries(evil), /Unsafe ZIP entry path/);
});

test('parseSha256Text parses standard sha256sum output', () => {
  const digest = 'a'.repeat(64);
  assert.deepEqual(parseSha256Text(`${digest}  antigrative-dashboard-0.9.1.zip\n`), {
    digest,
    filename: 'antigrative-dashboard-0.9.1.zip',
  });
  assert.equal(parseSha256Text('invalid'), null);
});

test('DashboardUpdater checks GitHub latest, verifies SHA256, updates runtime files atomically and preserves user data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ag-pulse-updater-'));
  try {
    const pluginDir = join(root, 'antigravity-pulse');
    const stateFile = join(root, 'data', 'update-state.json');
    await mkdir(join(pluginDir, 'sidecars', 'panel', 'data'), { recursive: true });
    await mkdir(join(pluginDir, 'compat'), { recursive: true });
    await writeFile(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-pulse', version: '0.9.0' }));
    await writeFile(join(pluginDir, 'compat', 'inline-widget.cjs'), '// old widget');
    await writeFile(join(pluginDir, 'sidecars', 'panel', 'data', 'keep.json'), '{"user":true}');

    const zipBytes = buildZip({
      'antigrative-dashboard/plugin.json': JSON.stringify({ name: 'antigravity-pulse', version: '0.9.1' }),
      'antigrative-dashboard/compat/inline-widget.cjs': '// new widget 0.9.1',
      'antigrative-dashboard/compat/runtime-ui.mjs': '// runtime 0.9.1',
      'antigrative-dashboard/sidecars/panel/main.mjs': '// main 0.9.1',
      'antigrative-dashboard/sidecars/panel/data/should-ignore.json': '{"evil":true}',
      'antigrative-dashboard/README.md': 'ignored non-runtime',
    });
    const zipSha = createHash('sha256').update(zipBytes).digest('hex');

    const releasePayload = {
      tag_name: 'v0.9.1',
      draft: false,
      prerelease: false,
      html_url: 'https://github.com/NoobCock/antigravity-dashboard/releases/tag/v0.9.1',
      published_at: '2026-11-24T03:00:00Z',
      assets: [
        { name: 'antigrative-dashboard-ide-0.9.1.vsix', browser_download_url: 'https://github.com/NoobCock/antigravity-dashboard/releases/download/v0.9.1/antigrative-dashboard-ide-0.9.1.vsix' },
        { name: 'antigrative-dashboard-0.9.1.zip', browser_download_url: 'https://github.com/NoobCock/antigravity-dashboard/releases/download/v0.9.1/antigrative-dashboard-0.9.1.zip' },
        { name: 'antigrative-dashboard-0.9.1.zip.sha256', browser_download_url: 'https://github.com/NoobCock/antigravity-dashboard/releases/download/v0.9.1/antigrative-dashboard-0.9.1.zip.sha256' },
      ],
    };

    const fetchImpl = async url => {
      if (url === 'https://api.github.com/repos/NoobCock/antigravity-dashboard/releases/latest') {
        return mockResponse(200, releasePayload);
      }
      if (url === 'https://release-assets.githubusercontent.com/pkg/bundle.zip') {
        return mockResponse(200, zipBytes);
      }
      if (url.endsWith('.zip')) {
        return mockResponse(302, '', { location: 'https://release-assets.githubusercontent.com/pkg/bundle.zip' });
      }
      if (url.endsWith('.zip.sha256')) {
        return mockResponse(200, `${zipSha}  antigrative-dashboard-0.9.1.zip\n`);
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    let restarted = null;
    const updater = new DashboardUpdater({
      pluginDir,
      stateFile,
      fetchImpl,
      onUpdated: info => { restarted = info; },
      env: {},
    });

    const result = await updater.check({ force: true, autoApply: true });
    assert.equal(result.ok, true);
    assert.equal(result.updated, true);
    assert.equal(result.status, 'updated');
    assert.deepEqual(restarted, { from: '0.9.0', to: '0.9.1' });

    const updatedManifest = JSON.parse(await readFile(join(pluginDir, 'plugin.json'), 'utf8'));
    assert.equal(updatedManifest.version, '0.9.1');
    assert.equal(await readFile(join(pluginDir, 'compat', 'inline-widget.cjs'), 'utf8'), '// new widget 0.9.1');
    assert.equal(await readFile(join(pluginDir, 'sidecars', 'panel', 'data', 'keep.json'), 'utf8'), '{"user":true}');
    await assert.rejects(() => readFile(join(pluginDir, 'sidecars', 'panel', 'data', 'should-ignore.json')));
    await assert.rejects(() => readFile(join(pluginDir, 'README.md')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('DashboardUpdater rejects SHA256 mismatch, untrusted redirect hosts, and dev checkouts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ag-pulse-updater-guard-'));
  try {
    const pluginDir = join(root, 'antigravity-pulse');
    const stateFile = join(root, 'data', 'update-state.json');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-pulse', version: '0.9.0' }));

    const badZip = buildZip({ 'antigrative-dashboard/plugin.json': '{"name":"antigravity-pulse","version":"0.9.2"}' });
    const releasePayload = {
      tag_name: 'v0.9.2',
      draft: false,
      prerelease: false,
      html_url: 'https://github.com/NoobCock/antigravity-dashboard/releases/tag/v0.9.2',
      assets: [
        { name: 'antigrative-dashboard-0.9.2.zip', browser_download_url: 'https://github.com/NoobCock/antigravity-dashboard/releases/download/v0.9.2/antigrative-dashboard-0.9.2.zip' },
        { name: 'antigrative-dashboard-0.9.2.zip.sha256', browser_download_url: 'https://github.com/NoobCock/antigravity-dashboard/releases/download/v0.9.2/antigrative-dashboard-0.9.2.zip.sha256' },
      ],
    };

    // 1. Bad checksum must fail without modifying plugin.json
    const updater1 = new DashboardUpdater({
      pluginDir,
      stateFile,
      fetchImpl: async url => {
        if (url.includes('/releases/latest')) return mockResponse(200, releasePayload);
        if (url.endsWith('.sha256')) return mockResponse(200, `${'0'.repeat(64)}  antigrative-dashboard-0.9.2.zip\n`);
        return mockResponse(200, badZip);
      },
      env: {},
    });
    const r1 = await updater1.check({ force: true, autoApply: true });
    assert.equal(r1.ok, false);
    assert.match(r1.error, /checksum mismatch/i);
    assert.equal(JSON.parse(await readFile(join(pluginDir, 'plugin.json'), 'utf8')).version, '0.9.0');

    // 2. Untrusted redirect host must be rejected
    const updater2 = new DashboardUpdater({
      pluginDir,
      stateFile: join(root, 'data', 'state2.json'),
      fetchImpl: async url => {
        if (url.includes('/releases/latest')) return mockResponse(200, releasePayload);
        if (url.endsWith('.sha256')) return mockResponse(302, '', { location: 'https://evil.example.com/sha' });
        return mockResponse(200, badZip);
      },
      env: {},
    });
    const r2 = await updater2.check({ force: true, autoApply: true });
    assert.equal(r2.ok, false);
    assert.match(r2.error, /Untrusted update host/i);

    // 3. Git checkout must refuse self-overwrite
    await mkdir(join(pluginDir, '.git'), { recursive: true });
    const updater3 = new DashboardUpdater({
      pluginDir,
      stateFile: join(root, 'data', 'state3.json'),
      fetchImpl: async () => mockResponse(200, releasePayload),
      env: {},
    });
    const r3 = await updater3.applyUpdate();
    assert.equal(r3.ok, false);
    assert.match(r3.error, /git workspace/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
