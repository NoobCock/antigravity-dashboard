// Dependency-free, reversible ASAR keep-alive self-healer.
// Detects when Antigravity auto-updates overwrite resources/app.asar and
// re-applies the verified inline adapter with full backup parity for uninstall.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedAppAsar, platformPaths } from './platform.mjs';

// Electron's ELECTRON_RUN_AS_NODE sidecar patches `node:fs` to treat `.asar`
// paths as virtual directories. Always use `original-fs` when available so
// `.asar` archives are read, stat'd, backed up, and written as raw files.
const require = createRequire(import.meta.url);
let rawFs = nodeFs;
try { rawFs = require('original-fs'); } catch {}
const { existsSync } = rawFs;
const { mkdir, readdir, readFile, rename, stat, unlink, writeFile } = rawFs.promises || nodeFs.promises;

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF_FILE = fileURLToPath(import.meta.url);
export const ADAPTER_MARKER = '// AG_PULSE_INLINE_V1';
const SUPPORTED_VERSIONS = new Set(['2.19.1', '2.32.2', '2.33.0']);
const WATCH_INTERVAL_MS = 30_000;
const STARTUP_DELAY_MS = 1_500;
const WAITER_TIMEOUT_MS = 30 * 60 * 1000;
const WAITER_POLL_MS = 1_500;
const LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

export function isSupportedHostVersion(version) {
  if (SUPPORTED_VERSIONS.has(version)) return true;
  if (typeof version === 'string' && version.startsWith('2.')) {
    const parts = version.split('.').slice(0, 2).map(p => Number(p));
    if (parts.length === 2 && parts.every(Number.isInteger)) {
      return parts[0] > 2 || (parts[0] === 2 && parts[1] >= 32);
    }
  }
  return false;
}

export function parseAsar(data) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);
  if (data.length < 16) throw new Error('Invalid ASAR archive');
  const s0 = data.readUInt32LE(0);
  const s1 = data.readUInt32LE(4);
  const s2 = data.readUInt32LE(8);
  const s3 = data.readUInt32LE(12);
  if (s0 !== 4 || s3 === 0 || 16 + s3 > data.length || 8 + s1 > data.length) {
    throw new Error('Corrupt ASAR header');
  }
  const header = JSON.parse(data.subarray(16, 16 + s3).toString('utf8'));
  return { header, base: 8 + s1, sizes: [s0, s1, s2, s3] };
}

export function walkAsar(entry, prefix = '', out = []) {
  const files = entry?.files;
  if (!files || typeof files !== 'object') return out;
  for (const [key, value] of Object.entries(files)) {
    const path = prefix ? `${prefix}/${key}` : key;
    if (value && typeof value === 'object' && value.files) {
      walkAsar(value, path, out);
    } else if (value && typeof value === 'object' && value.offset !== undefined && !value.unpacked) {
      out.push([path, value]);
    }
  }
  return out;
}

function readAsarFile(data, header, base, segments) {
  let cur = header;
  for (const seg of segments) {
    cur = cur?.files?.[seg];
    if (!cur) return null;
  }
  if (cur.offset === undefined || cur.unpacked) return null;
  const start = base + Number(cur.offset);
  const size = Number(cur.size);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start < base || start + size > data.length) {
    throw new Error('Invalid ASAR file entry bounds');
  }
  return data.subarray(start, start + size);
}

export function inspectAsar(data) {
  const { header, base } = parseAsar(data);
  const pkgBuf = readAsarFile(data, header, base, ['package.json']);
  const version = pkgBuf ? JSON.parse(pkgBuf.toString('utf8')).version || null : null;
  const preloadBuf = readAsarFile(data, header, base, ['dist', 'preload.js']);
  const mainBuf = readAsarFile(data, header, base, ['dist', 'main.js']);
  const preloadText = preloadBuf ? preloadBuf.toString('utf8') : '';
  const mainText = mainBuf ? mainBuf.toString('utf8') : '';
  const hasMarker = preloadText.includes(ADAPTER_MARKER);
  const hasDebugHook = mainText.includes(ADAPTER_MARKER);
  const needsAdapter = mainText.includes('removeStaleActivePortFile');
  const patchedComplete = hasMarker && (!needsAdapter || hasDebugHook);
  return { version, hasMarker, hasDebugHook, needsAdapter, patchedComplete };
}

function extractModuleFn(source) {
  const prefix = 'module.exports = ';
  const idx = source.indexOf(prefix);
  if (idx < 0) throw new Error('Adapter module format changed');
  return source.slice(idx + prefix.length).trim().replace(/;$/, '');
}

function asciiJsonString(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

export async function buildPatchedAsar(originalData, compatDir = HERE) {
  if (!Buffer.isBuffer(originalData)) originalData = Buffer.from(originalData);
  const { header, base } = parseAsar(originalData);
  const files = walkAsar(header);
  const bodies = new Map();
  for (const [name, entry] of files) {
    const start = base + Number(entry.offset);
    const size = Number(entry.size);
    bodies.set(name, originalData.subarray(start, start + size));
  }

  const pkgBuf = bodies.get('package.json');
  if (!pkgBuf) throw new Error('ASAR missing package.json');
  const version = JSON.parse(pkgBuf.toString('utf8')).version;
  if (!isSupportedHostVersion(version)) {
    throw new Error(`Unsupported Antigravity version ${version}`);
  }

  const preloadBuf = bodies.get('dist/preload.js');
  if (!preloadBuf) throw new Error('ASAR missing dist/preload.js');
  const oldPreload = preloadBuf.toString('utf8');
  if (!oldPreload.includes('electron_1.contextBridge.exposeInMainWorld')) {
    throw new Error('The renderer bridge is incompatible with this app build.');
  }
  if (oldPreload.includes(ADAPTER_MARKER)) {
    throw new Error('The UI adapter is already installed.');
  }

  const [widgetSrc, ipcHostSrc, i18nSrc, themeSrc, usageSrc] = await Promise.all([
    readFile(join(compatDir, 'inline-widget.cjs'), 'utf8'),
    readFile(join(compatDir, 'ipc-host.cjs'), 'utf8'),
    readFile(join(compatDir, 'i18n.cjs'), 'utf8'),
    readFile(join(compatDir, 'theme.cjs'), 'utf8'),
    readFile(join(compatDir, 'usage-ui.cjs'), 'utf8'),
  ]);

  const widgetFn = extractModuleFn(widgetSrc);
  const hostFn = extractModuleFn(ipcHostSrc);
  const i18nFn = extractModuleFn(i18nSrc);
  const themeFn = extractModuleFn(themeSrc);
  const usageFn = extractModuleFn(usageSrc);

  const preloadAddition = `\n${ADAPTER_MARKER}
electron_1.contextBridge.exposeInMainWorld("agPulseHost", {
  getMetrics: (input) => electron_1.ipcRenderer.invoke("ag-pulse:metrics", input),
  getPreferences: () => electron_1.ipcRenderer.invoke("ag-pulse:preferences", {}),
  setPreferences: (input) => electron_1.ipcRenderer.invoke("ag-pulse:preferences", input),
  getPricing: () => electron_1.ipcRenderer.invoke("ag-pulse:pricing", {action: "get"}),
  updatePricing: (input) => electron_1.ipcRenderer.invoke("ag-pulse:pricing", input),
  report: (state) => electron_1.ipcRenderer.send("ag-pulse:diagnostic", state)
});
`;
  bodies.set('dist/preload.js', Buffer.from(oldPreload + preloadAddition, 'utf8'));

  const ipcBuf = bodies.get('dist/ipcHandlers.js');
  if (!ipcBuf) throw new Error('ASAR missing dist/ipcHandlers.js');
  const ipcSource = ipcBuf.toString('utf8');
  if (!ipcSource.includes('customScheme_1.extensionAuthorities')) {
    throw new Error('The local IPC integration is incompatible with this app build.');
  }
  bodies.set('dist/ipcHandlers.js', Buffer.from(`${ipcSource}\n${ADAPTER_MARKER}\n(${hostFn})(electron_1, customScheme_1.extensionAuthorities);\n`, 'utf8'));

  const utilsBuf = bodies.get('dist/utils.js');
  if (!utilsBuf) throw new Error('ASAR missing dist/utils.js');
  const utils = utilsBuf.toString('utf8');
  const anchorWin = '    win.webContents.setWindowOpenHandler((details) => {';
  const anchorHub = '    hubContents.setWindowOpenHandler((details) => {';
  let anchor = null;
  let contentsTarget = null;
  if (utils.split(anchorWin).length - 1 === 1) {
    anchor = anchorWin;
    contentsTarget = 'win.webContents';
  } else if (utils.split(anchorHub).length - 1 === 1) {
    anchor = anchorHub;
    contentsTarget = 'hubContents';
  } else {
    throw new Error('Window startup integration is incompatible with this build.');
  }
  const scriptLiteral = asciiJsonString(
    `window.__agPulseUsageFactory=(${usageFn});window.__agPulseI18nFactory=(${i18nFn});window.__agPulseThemeFactory=(${themeFn});(${widgetFn})();`
  );
  const hook = `    ${ADAPTER_MARKER}\n    ${contentsTarget}.on('dom-ready', () => {\n        void ${contentsTarget}.executeJavaScript(${scriptLiteral}).catch(() => console.warn('[Antigrative Dashboard] Widget startup failed.'));\n    });\n`;
  bodies.set('dist/utils.js', Buffer.from(utils.replace(anchor, () => hook + anchor), 'utf8'));

  const mainBuf = bodies.get('dist/main.js');
  if (mainBuf) {
    const mainSource = mainBuf.toString('utf8');
    const mainAnchor = "electron_1.app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');";
    if (mainSource.includes('removeStaleActivePortFile') && mainSource.includes(mainAnchor) && !mainSource.includes(ADAPTER_MARKER)) {
      const debugHook = `${ADAPTER_MARKER}\nif (!electron_1.app.commandLine.hasSwitch('remote-debugging-port')) {\n    electron_1.app.commandLine.appendSwitch('remote-debugging-port', '0');\n    electron_1.app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');\n}\n`;
      bodies.set('dist/main.js', Buffer.from(mainSource.replace(mainAnchor, () => debugHook + mainAnchor), 'utf8'));
    }
  }

  let cursor = 0;
  const packed = [];
  const sorted = [...files].sort((a, b) => Number(a[1].offset) - Number(b[1].offset));
  for (const [name, entry] of sorted) {
    const body = bodies.get(name);
    entry.offset = String(cursor);
    entry.size = body.length;
    if (entry.integrity) {
      const blockSize = Number(entry.integrity.blockSize) || 4194304;
      const blocks = [];
      for (let i = 0; i < body.length; i += blockSize) {
        blocks.push(sha256(body.subarray(i, Math.min(body.length, i + blockSize))));
      }
      entry.integrity = { algorithm: 'SHA256', hash: sha256(body), blockSize, blocks };
    }
    packed.push(body);
    cursor += body.length;
  }

  const rawHeader = Buffer.from(JSON.stringify(header), 'utf8');
  const pad = (4 - (rawHeader.length % 4)) % 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(8 + rawHeader.length + pad, 4);
  prefix.writeUInt32LE(4 + rawHeader.length + pad, 8);
  prefix.writeUInt32LE(rawHeader.length, 12);
  const result = Buffer.concat([prefix, rawHeader, Buffer.alloc(pad), ...packed]);

  // Verify every packed entry & integrity hash before returning.
  const verified = parseAsar(result);
  for (const [name, entry] of walkAsar(verified.header)) {
    const start = verified.base + Number(entry.offset);
    const slice = result.subarray(start, start + Number(entry.size));
    const expected = bodies.get(name);
    if (!expected || !slice.equals(expected)) throw new Error(`ASAR verification mismatch: ${name}`);
    if (entry.integrity && sha256(slice) !== entry.integrity.hash) {
      throw new Error(`ASAR integrity mismatch: ${name}`);
    }
  }
  return { patched: result, version };
}

function formatBackupStamp(now = Date.now()) {
  const d = new Date(now);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function hasMatchingBackup(backupsDir, originalSha, patchedSha) {
  try {
    const entries = await readdir(backupsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      try {
        const note = JSON.parse(await readFile(join(backupsDir, ent.name, 'patch.json'), 'utf8'));
        if (note.originalSha256 === originalSha && note.patchedSha256 === patchedSha) {
          if (existsSync(join(backupsDir, ent.name, 'app.asar'))) return true;
        }
      } catch {}
    }
  } catch {}
  return false;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function defaultNotify({ status, appVersion, language = 'zh-CN', env = process.env } = {}) {
  if (process.platform !== 'win32') return;
  const flag = String(env?.AG_PULSE_DISABLE_KEEPALIVE_NOTIFY || '').trim().toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes' || env?.NODE_TEST_CONTEXT) return;
  const zh = language === 'zh-CN';
  const ver = appVersion ? `v${appVersion}` : (zh ? '新版本' : 'latest build');
  const title = zh ? 'Antigrative Dashboard 自动保活已完成' : 'Antigrative Dashboard Auto-Repaired';
  const body = status === 'staged-pending-exit'
    ? (zh ? `检测到 Antigravity 已更新至 ${ver}，补丁已就绪；退出并重开 Antigravity 将自动恢复状态条。`
          : `Detected Antigravity ${ver}. Repair is staged and will apply when Antigravity restarts.`)
    : (zh ? `检测到 Antigravity 已更新至 ${ver}，已自动修补内嵌状态条；重启一次 Antigravity 即可恢复显示。`
          : `Detected Antigravity ${ver} and auto-repaired the inline status bar. Restart Antigravity once to activate.`);
  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$t=[System.Security.SecurityElement]::Escape($env:AG_NOTIFY_TITLE)",
    "$b=[System.Security.SecurityElement]::Escape($env:AG_NOTIFY_BODY)",
    "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime]|Out-Null",
    "$xml=New-Object Windows.Data.Xml.Dom.XmlDocument",
    "$xml.LoadXml(\"<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>\")",
    "$toast=[Windows.UI.Notifications.ToastNotification]::new($xml)",
    "$appId='{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)",
  ].join(';');
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, AG_NOTIFY_TITLE: title, AG_NOTIFY_BODY: body },
    });
    child.unref();
  } catch {}
}

function defaultSpawnWaiter({ target, stagedPath, originalSha, patchedSha, statePath, appVersion, timeoutMs = WAITER_TIMEOUT_MS, pollMs = WAITER_POLL_MS }) {
  const child = spawn(process.execPath, [SELF_FILE, '--apply-staged'], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ...(process.versions?.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      AG_KA_TARGET: target,
      AG_KA_STAGED: stagedPath,
      AG_KA_ORIG_SHA: originalSha,
      AG_KA_PATCHED_SHA: patchedSha,
      AG_KA_STATE: statePath || '',
      AG_KA_VERSION: appVersion || '',
      AG_KA_TIMEOUT_MS: String(timeoutMs),
      AG_KA_POLL_MS: String(pollMs),
    },
  });
  child.unref();
  return child;
}

async function writeAtomicJson(file, payload) {
  if (!file) return;
  try {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
    await rename(tmp, file);
  } catch {}
}

export async function runStagedWaiter({
  target = process.env.AG_KA_TARGET,
  stagedPath = process.env.AG_KA_STAGED,
  originalSha = process.env.AG_KA_ORIG_SHA,
  patchedSha = process.env.AG_KA_PATCHED_SHA,
  statePath = process.env.AG_KA_STATE,
  appVersion = process.env.AG_KA_VERSION || null,
  timeoutMs = Number(process.env.AG_KA_TIMEOUT_MS) || WAITER_TIMEOUT_MS,
  pollMs = Number(process.env.AG_KA_POLL_MS) || WAITER_POLL_MS,
  writeTarget = (p, buf) => writeFile(p, buf),
} = {}) {
  if (!target || !stagedPath || !originalSha || !patchedSha) return 1;
  const deadline = Date.now() + Math.max(100, timeoutMs);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  while (Date.now() < deadline) {
    if (!existsSync(stagedPath) || !existsSync(target)) return 0;
    let current;
    try {
      current = await readFile(target);
    } catch (error) {
      if (LOCK_CODES.has(error?.code)) { await sleep(pollMs); continue; }
      return 1;
    }
    const curSha = sha256(current);
    if (curSha === patchedSha) {
      await unlink(stagedPath).catch(() => {});
      return 0;
    }
    if (curSha !== originalSha) {
      await unlink(stagedPath).catch(() => {});
      return 0;
    }
    let staged;
    try {
      staged = await readFile(stagedPath);
    } catch {
      return 0;
    }
    if (sha256(staged) !== patchedSha) {
      await unlink(stagedPath).catch(() => {});
      return 1;
    }
    try {
      await writeTarget(target, staged);
      const written = await readFile(target);
      if (!written.equals(staged)) throw new Error('Staged verification mismatch');
      const iso = new Date().toISOString();
      await writeAtomicJson(statePath, {
        status: 'healthy',
        appVersion: appVersion || null,
        checkedAt: iso,
        repairedAt: iso,
        restartRequired: false,
        error: null,
      });
      await unlink(stagedPath).catch(() => {});
      return 0;
    } catch (error) {
      if (LOCK_CODES.has(error?.code)) {
        await sleep(pollMs);
        continue;
      }
      try { await writeFile(target, current); } catch {}
      return 1;
    }
  }
  await unlink(stagedPath).catch(() => {});
  return 0;
}

export class AsarKeepAlive {
  constructor({
    platform = process.platform,
    appAsar = () => installedAppAsar({ platform }),
    backupsDir = platformPaths({ platform }).backups,
    dataDir = platformPaths({ platform }).data,
    compatDir = HERE,
    enabled = () => true,
    owns = async () => true,
    env = process.env,
    intervalMs = WATCH_INTERVAL_MS,
    startupDelayMs = STARTUP_DELAY_MS,
    writeTarget = (p, buf) => writeFile(p, buf),
    spawnWaiter = defaultSpawnWaiter,
    notify = defaultNotify,
    getLanguage = async () => 'zh-CN',
  } = {}) {
    this.platform = platform;
    this.appAsar = typeof appAsar === 'function' ? appAsar : () => appAsar;
    this.backupsDir = backupsDir;
    this.dataDir = dataDir;
    this.compatDir = resolve(compatDir);
    this.enabled = enabled;
    this.owns = owns;
    this.env = env;
    this.intervalMs = intervalMs;
    this.startupDelayMs = startupDelayMs;
    this.writeTarget = writeTarget;
    this.spawnWaiter = spawnWaiter;
    this.notify = notify;
    this.getLanguage = getLanguage;

    this.running = false;
    this.busy = false;
    this.startupTimer = null;
    this.watchTimer = null;
    this.lastStatKey = null;
    this.lastFailedSha = null;
    this.notifiedKey = null;
    this.waiterPid = null;
    this.waiterSha = null;
    this.waiterUntil = 0;
    this.state = {
      status: 'idle',
      appVersion: null,
      checkedAt: null,
      repairedAt: null,
      restartRequired: false,
      error: null,
    };
  }

  disabledByEnv() {
    const flag = String(this.env?.AG_PULSE_DISABLE_KEEPALIVE || '').trim().toLowerCase();
    return flag === '1' || flag === 'true' || flag === 'yes';
  }

  stagedPath() {
    return this.dataDir ? join(this.dataDir, 'pending-app.asar') : null;
  }

  statePath() {
    return this.dataDir ? join(this.dataDir, 'keepalive-state.json') : null;
  }

  async clearStaged() {
    this.waiterPid = null;
    this.waiterSha = null;
    this.waiterUntil = 0;
    const staged = this.stagedPath();
    if (staged) await unlink(staged).catch(() => {});
  }

  snapshot() {
    return { ...this.state };
  }

  async persistState() {
    await writeAtomicJson(this.statePath(), this.state);
  }

  async notifyOnce(status, appVersion, uniqueKey) {
    if (typeof this.notify !== 'function') return;
    const key = `${status}:${appVersion || ''}:${uniqueKey || ''}`;
    if (this.notifiedKey === key) return;
    this.notifiedKey = key;
    try {
      const language = await this.getLanguage();
      this.notify({ status, appVersion, language, env: this.env });
    } catch {}
  }

  async check({ force = false, now = Date.now() } = {}) {
    if (this.busy) return this.snapshot();
    this.busy = true;
    try {
      if (this.platform !== 'win32' || this.disabledByEnv() || !await this.enabled() || !await this.owns()) {
        await this.clearStaged();
        this.state = { ...this.state, status: 'disabled', checkedAt: new Date(now).toISOString(), error: null };
        return this.snapshot();
      }
      const target = this.appAsar();
      if (!target || !existsSync(target)) {
        this.state = { ...this.state, status: 'not-found', checkedAt: new Date(now).toISOString(), error: null };
        return this.snapshot();
      }
      const st = await stat(target);
      const statKey = `${target}:${st.size}:${Math.trunc(st.mtimeMs)}`;
      const stagedPath = this.stagedPath();
      if (!force && statKey === this.lastStatKey) {
        if (this.state.status !== 'staged-pending-exit') {
          return this.snapshot();
        }
        if (this.waiterPid && isPidAlive(this.waiterPid) && stagedPath && existsSync(stagedPath) && now < this.waiterUntil) {
          return this.snapshot();
        }
      }

      const current = await readFile(target);
      const currentSha = sha256(current);
      if (!force && currentSha === this.lastFailedSha) {
        this.lastStatKey = statKey;
        return this.snapshot();
      }

      const info = inspectAsar(current);
      if (!info.needsAdapter) {
        await this.clearStaged();
        this.lastStatKey = statKey;
        this.state = {
          status: 'not-needed',
          appVersion: info.version,
          checkedAt: new Date(now).toISOString(),
          repairedAt: this.state.repairedAt,
          restartRequired: false,
          error: null,
        };
        await this.persistState();
        return this.snapshot();
      }

      if (info.patchedComplete) {
        await this.clearStaged();
        this.lastStatKey = statKey;
        this.state = {
          status: this.state.restartRequired ? 'repaired-restart-needed' : 'healthy',
          appVersion: info.version,
          checkedAt: new Date(now).toISOString(),
          repairedAt: this.state.repairedAt,
          restartRequired: this.state.restartRequired,
          error: null,
        };
        await this.persistState();
        return this.snapshot();
      }

      if (info.hasMarker) {
        await this.clearStaged();
        this.lastStatKey = statKey;
        this.lastFailedSha = currentSha;
        this.state = {
          status: 'skipped-unknown-patch',
          appVersion: info.version,
          checkedAt: new Date(now).toISOString(),
          repairedAt: this.state.repairedAt,
          restartRequired: false,
          error: 'Existing archive has unrecognized adapter edits',
        };
        await this.persistState();
        return this.snapshot();
      }

      // Antigravity updated and replaced app.asar with an unpatched build: auto-repair!
      const { patched, version } = await buildPatchedAsar(current, this.compatDir);
      const patchedSha = sha256(patched);

      if (!(await hasMatchingBackup(this.backupsDir, currentSha, patchedSha))) {
        let backupDir = join(this.backupsDir, formatBackupStamp(now));
        if (existsSync(backupDir)) backupDir = `${backupDir}-${randomUUID().slice(0, 6)}`;
        await mkdir(backupDir, { recursive: true });
        await writeFile(join(backupDir, 'app.asar'), current);
        await writeFile(
          join(backupDir, 'patch.json'),
          JSON.stringify({ originalSha256: currentSha, patchedSha256: patchedSha, appVersion: version, source: 'keepalive' }, null, 2),
          'utf8'
        );
      }

      try {
        await this.writeTarget(target, patched);
        const written = await readFile(target);
        if (!written.equals(patched)) throw new Error('Patched archive verification failed');
      } catch (writeErr) {
        const locked = LOCK_CODES.has(writeErr?.code);
        if (!locked) {
          try { await writeFile(target, current); } catch {}
          throw writeErr;
        }
        if (stagedPath) {
          await mkdir(dirname(stagedPath), { recursive: true });
          const tmpStaged = `${stagedPath}.${randomUUID()}.tmp`;
          await writeFile(tmpStaged, patched);
          try { await rename(tmpStaged, stagedPath); }
          catch { await writeFile(stagedPath, patched); await unlink(tmpStaged).catch(() => {}); }
          const alreadyWaiting = this.waiterSha === currentSha && this.waiterPid && isPidAlive(this.waiterPid) && now < this.waiterUntil;
          if (!alreadyWaiting) {
            const child = this.spawnWaiter({
              target,
              stagedPath,
              originalSha: currentSha,
              patchedSha,
              statePath: this.statePath(),
              appVersion: version,
            });
            this.waiterPid = child?.pid || null;
            this.waiterSha = currentSha;
            this.waiterUntil = now + WAITER_TIMEOUT_MS - 60_000;
          }
          this.lastStatKey = statKey;
          this.state = {
            status: 'staged-pending-exit',
            appVersion: version,
            checkedAt: new Date(now).toISOString(),
            repairedAt: this.state.repairedAt,
            restartRequired: true,
            error: null,
          };
          await this.persistState();
          await this.notifyOnce('staged-pending-exit', version, currentSha);
          return this.snapshot();
        }
        throw writeErr;
      }

      await this.clearStaged();
      const nextSt = await stat(target);
      this.lastStatKey = `${target}:${nextSt.size}:${Math.trunc(nextSt.mtimeMs)}`;
      this.lastFailedSha = null;
      const iso = new Date(now).toISOString();
      this.state = {
        status: 'repaired-restart-needed',
        appVersion: version,
        checkedAt: iso,
        repairedAt: iso,
        restartRequired: true,
        error: null,
      };
      await this.persistState();
      await this.notifyOnce('repaired-restart-needed', version, currentSha);
      return this.snapshot();
    } catch (error) {
      this.state = {
        ...this.state,
        status: 'error',
        checkedAt: new Date(now).toISOString(),
        error: error?.message || 'Keep-alive check failed',
      };
      try {
        const target = this.appAsar();
        if (target && existsSync(target) && !LOCK_CODES.has(error?.code)) {
          this.lastFailedSha = sha256(await readFile(target));
        }
      } catch {}
      await this.persistState();
      return this.snapshot();
    } finally {
      this.busy = false;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startupTimer = setTimeout(() => { void this.check().catch(() => {}); }, this.startupDelayMs);
    this.startupTimer.unref?.();
    this.watchTimer = setInterval(() => { void this.check().catch(() => {}); }, this.intervalMs);
    this.watchTimer.unref?.();
  }

  stop() {
    this.running = false;
    clearTimeout(this.startupTimer); this.startupTimer = null;
    clearInterval(this.watchTimer); this.watchTimer = null;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === SELF_FILE;
if (isMain && process.argv.includes('--apply-staged')) {
  void runStagedWaiter().then(code => process.exit(code)).catch(() => process.exit(1));
}
