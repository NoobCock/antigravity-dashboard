// Dependency-free GitHub Releases (/releases/latest) auto-updater for Antigrative Dashboard.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { platformPaths } from '../../compat/platform.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_UPDATE_REPO = 'NoobCock/antigravity-dashboard';
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const CHECK_TTL_MS = 6 * 3600 * 1000;
const MAX_META_BYTES = 512 * 1024;
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 600;
const TRUSTED_API_HOSTS = new Set(['api.github.com']);
const TRUSTED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'codeload.github.com',
]);
const RUNTIME_TOP_DIRS = new Set(['assets', 'compat', 'sidecars']);
const RUNTIME_ROOT_FILES = new Set(['plugin.json']);
const SKIPPED_SEGMENTS = new Set(['__pycache__', '.git', '.data', 'node_modules', 'data', 'history-v1', 'usage-v1', 'quota-calibration-v1', 'sdk']);

// Precomputed IEEE 802.3 CRC32 table for ZIP integrity checks.
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC32_TABLE[i] = c >>> 0;
}

export function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC32_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function parseVersion(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
    normalized: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}${match[4] ? '-' + match[4] : ''}`,
  };
}

export function compareVersions(a, b) {
  const va = typeof a === 'object' && a?.major != null ? a : parseVersion(a);
  const vb = typeof b === 'object' && b?.major != null ? b : parseVersion(b);
  if (!va || !vb) return null;
  for (const field of ['major', 'minor', 'patch']) {
    if (va[field] !== vb[field]) return va[field] > vb[field] ? 1 : -1;
  }
  if (va.prerelease === vb.prerelease) return 0;
  if (!va.prerelease) return 1;
  if (!vb.prerelease) return -1;
  const ap = va.prerelease.split('.');
  const bp = vb.prerelease.split('.');
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    if (ap[i] === undefined) return -1;
    if (bp[i] === undefined) return 1;
    const an = /^\d+$/.test(ap[i]) ? Number(ap[i]) : null;
    const bn = /^\d+$/.test(bp[i]) ? Number(bp[i]) : null;
    if (an !== null && bn !== null) {
      if (an !== bn) return an > bn ? 1 : -1;
    } else if (ap[i] !== bp[i]) {
      return ap[i] > bp[i] ? 1 : -1;
    }
  }
  return 0;
}

export function parseSha256Text(text) {
  if (typeof text !== 'string') return null;
  const line = text.trim().split(/\r?\n/).find(l => l.trim());
  if (!line) return null;
  const match = line.trim().match(/^([0-9a-f]{64})(?:\s+\*?(.+))?$/i);
  if (!match) return null;
  return { digest: match[1].toLowerCase(), filename: match[2]?.trim() || null };
}

export function extractZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 22) throw new Error('Invalid ZIP archive');

  // Locate End of Central Directory record (signature 0x06054b50).
  const minOffset = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      const commentLen = buffer.readUInt16LE(i + 20);
      if (i + 22 + commentLen === buffer.length) {
        eocd = i;
        break;
      }
    }
  }
  if (eocd < 0) throw new Error('ZIP central directory not found');

  const diskNo = buffer.readUInt16LE(eocd + 4);
  const cdDisk = buffer.readUInt16LE(eocd + 6);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (diskNo !== 0 || cdDisk !== 0 || entryCount === 0xffff || cdOffset === 0xffffffff) {
    throw new Error('Unsupported multi-disk or ZIP64 archive');
  }
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error('ZIP contains too many entries');
  if (cdOffset + cdSize > eocd) throw new Error('Corrupt ZIP central directory');

  const entries = new Map();
  let offset = cdOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > cdOffset + cdSize || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Corrupt ZIP entry header');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compSize = buffer.readUInt32LE(offset + 20);
    const uncompSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const extAttr = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const rawName = buffer.subarray(nameStart, nameStart + nameLen).toString('utf8');
    offset = nameStart + nameLen + extraLen + commentLen;

    if (flags & 1) throw new Error('Encrypted ZIP archives are not supported');
    if (rawName.endsWith('/')) continue; // directory entry
    if (rawName.includes('\0') || rawName.includes('\\') || rawName.startsWith('/')) {
      throw new Error(`Unsafe ZIP entry path: ${rawName}`);
    }
    const parts = rawName.split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || /^[A-Za-z]:/.test(p))) {
      throw new Error(`Unsafe ZIP entry path: ${rawName}`);
    }
    const mode = (extAttr >>> 16) & 0o170000;
    if (mode === 0o120000) throw new Error(`Symlink not allowed in ZIP: ${rawName}`);

    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error('Corrupt ZIP local file header');
    }
    const lNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const lExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > buffer.length) throw new Error('Truncated ZIP entry data');

    totalUncompressed += uncompSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error('ZIP uncompressed size exceeds safety limit');

    const compressed = buffer.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      data = inflateRawSync(compressed, { maxOutputLength: Math.max(uncompSize + 1024, 1024) });
    } else {
      throw new Error(`Unsupported ZIP compression method: ${method}`);
    }
    if (data.length !== uncompSize) throw new Error(`ZIP entry size mismatch: ${rawName}`);
    if (crc32(data) !== expectedCrc) throw new Error(`ZIP entry CRC mismatch: ${rawName}`);
    entries.set(rawName, data);
  }
  return entries;
}

async function readBoundedBytes(response, maxBytes) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        total += buf.length;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error('Response exceeds size limit');
        }
        chunks.push(buf);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
  }
  const arr = Buffer.from(await response.arrayBuffer());
  if (arr.length > maxBytes) throw new Error('Response exceeds size limit');
  return arr;
}

async function fetchVerified(url, { fetchImpl, allowedHosts, maxBytes, headers = {}, timeoutMs = 20000 }) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch unavailable');
  let current = url;
  for (let hops = 0; hops < 6; hops++) {
    const parsed = new URL(current);
    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
      throw new Error(`Untrusted update host: ${parsed.hostname}`);
    }
    const response = await fetchImpl(current, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.get?.('location');
      if (!location) throw new Error(`Redirect missing location (HTTP ${response.status})`);
      current = new URL(location, current).toString();
      continue;
    }
    return { status: response.status, ok: response.ok, bytes: await readBoundedBytes(response, maxBytes) };
  }
  throw new Error('Too many redirects');
}

function selectReleaseAssets(assets) {
  if (!Array.isArray(assets)) return { zip: null, sha256: null };
  const zip = assets.find(a => typeof a?.name === 'string' && /^antigrative-dashboard-(?!ide-).*\.zip$/i.test(a.name) && typeof a.browser_download_url === 'string') || null;
  if (!zip) return { zip: null, sha256: null };
  const sha256 = assets.find(a => a?.name === `${zip.name}.sha256` && typeof a.browser_download_url === 'string') || null;
  return { zip, sha256 };
}

function runtimeRelativePath(zipEntryName) {
  const prefix = 'antigrative-dashboard/';
  if (!zipEntryName.startsWith(prefix)) return null;
  const rel = zipEntryName.slice(prefix.length);
  const parts = rel.split('/');
  if (!parts.length || parts.some(p => SKIPPED_SEGMENTS.has(p))) return null;
  if (parts.length === 1) return RUNTIME_ROOT_FILES.has(parts[0]) ? rel : null;
  if (!RUNTIME_TOP_DIRS.has(parts[0])) return null;
  if (rel.endsWith('.pyc') || rel.endsWith('.log')) return null;
  return rel;
}

export class DashboardUpdater {
  constructor({
    pluginDir = resolve(HERE, '..', '..'),
    stateFile = join(platformPaths().data, 'update-state.json'),
    repo = process.env.AG_PULSE_UPDATE_REPO || DEFAULT_UPDATE_REPO,
    fetchImpl = globalThis.fetch,
    ttlMs = CHECK_TTL_MS,
    allowDevUpdate = false,
    onUpdated = null,
    env = process.env,
  } = {}) {
    if (!REPO_RE.test(repo)) throw new Error('Invalid update repository format');
    this.pluginDir = resolve(pluginDir);
    this.stateFile = stateFile;
    this.repo = repo;
    this.fetchImpl = fetchImpl;
    this.ttlMs = ttlMs;
    this.allowDevUpdate = allowDevUpdate;
    this.onUpdated = onUpdated;
    this.env = env;
    this.state = null;
    this.writeQueue = Promise.resolve();
    this.checkPending = null;
    this.updatePending = null;
    this.busy = null; // null | 'checking' | 'updating'
    this.restartPending = false;
  }

  readCurrentVersion() {
    try {
      const manifest = JSON.parse(readFileSync(join(this.pluginDir, 'plugin.json'), 'utf8').replace(/^\uFEFF/, ''));
      if (manifest?.name === 'antigravity-pulse' && typeof manifest.version === 'string') {
        return manifest.version.trim();
      }
    } catch {}
    return '0.0.0';
  }

  isDevCheckout() {
    if (this.allowDevUpdate) return false;
    return existsSync(join(this.pluginDir, '.git'));
  }

  autoUpdateDisabledByEnv() {
    const flag = String(this.env?.AG_PULSE_DISABLE_AUTO_UPDATE || '').trim().toLowerCase();
    return flag === '1' || flag === 'true' || flag === 'yes';
  }

  async load() {
    if (this.state) return this.state;
    const defaults = {
      schema: 1,
      autoUpdate: !this.autoUpdateDisabledByEnv(),
      checkedAt: null,
      latestVersion: null,
      tag: null,
      releaseUrl: null,
      publishedAt: null,
      assetName: null,
      assetUrl: null,
      sha256Url: null,
      lastUpdatedVersion: null,
      lastUpdatedAt: null,
      lastFailedVersion: null,
      lastError: null,
    };
    try {
      const raw = JSON.parse((await readFile(this.stateFile, 'utf8')).replace(/^\uFEFF/, ''));
      if (raw?.schema === 1) {
        this.state = {
          ...defaults,
          autoUpdate: typeof raw.autoUpdate === 'boolean' ? raw.autoUpdate : defaults.autoUpdate,
          checkedAt: typeof raw.checkedAt === 'string' ? raw.checkedAt : null,
          latestVersion: typeof raw.latestVersion === 'string' ? raw.latestVersion : null,
          tag: typeof raw.tag === 'string' ? raw.tag : null,
          releaseUrl: typeof raw.releaseUrl === 'string' ? raw.releaseUrl : null,
          publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : null,
          assetName: typeof raw.assetName === 'string' ? raw.assetName : null,
          assetUrl: typeof raw.assetUrl === 'string' ? raw.assetUrl : null,
          sha256Url: typeof raw.sha256Url === 'string' ? raw.sha256Url : null,
          lastUpdatedVersion: typeof raw.lastUpdatedVersion === 'string' ? raw.lastUpdatedVersion : null,
          lastUpdatedAt: typeof raw.lastUpdatedAt === 'string' ? raw.lastUpdatedAt : null,
          lastFailedVersion: typeof raw.lastFailedVersion === 'string' ? raw.lastFailedVersion : null,
          lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
        };
        if (this.autoUpdateDisabledByEnv()) this.state.autoUpdate = false;
        return this.state;
      }
    } catch {}
    this.state = defaults;
    return this.state;
  }

  async persist() {
    if (!this.state) return;
    const payload = JSON.stringify(this.state, null, 2) + '\n';
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.stateFile), { recursive: true });
      const temp = `${this.stateFile}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, payload, { mode: 0o600 });
        await rename(temp, this.stateFile);
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error;
      }
    });
    return this.writeQueue;
  }

  snapshot() {
    const currentVersion = this.readCurrentVersion();
    const state = this.state;
    const devCheckout = this.isDevCheckout();
    const latestVersion = state?.latestVersion || null;
    const cmp = latestVersion ? compareVersions(latestVersion, currentVersion) : null;
    const updateAvailable = cmp === 1;
    let status = 'idle';
    if (this.busy === 'updating') status = 'updating';
    else if (this.busy === 'checking') status = 'checking';
    else if (this.restartPending) status = 'updated';
    else if (updateAvailable) status = 'available';
    else if (state?.lastError) status = 'error';
    else if (state?.checkedAt) status = 'up-to-date';
    return {
      currentVersion,
      latestVersion,
      tag: state?.tag || null,
      releaseUrl: state?.releaseUrl || `https://github.com/${this.repo}/releases/latest`,
      publishedAt: state?.publishedAt || null,
      checkedAt: state?.checkedAt || null,
      repo: this.repo,
      autoUpdate: state ? Boolean(state.autoUpdate) : !this.autoUpdateDisabledByEnv(),
      devCheckout,
      updateAvailable,
      hasAssets: Boolean(state?.assetUrl && state?.sha256Url),
      status,
      restartPending: this.restartPending,
      lastUpdatedVersion: state?.lastUpdatedVersion || null,
      lastUpdatedAt: state?.lastUpdatedAt || null,
      error: state?.lastError || null,
    };
  }

  async check({ force = false, autoApply = false, now = Date.now() } = {}) {
    const state = await this.load();
    const currentVersion = this.readCurrentVersion();
    const lastMs = state.checkedAt ? Date.parse(state.checkedAt) : NaN;
    if (!force && Number.isFinite(lastMs) && now - lastMs < this.ttlMs) {
      const snap = this.snapshot();
      if (autoApply && state.autoUpdate && !this.isDevCheckout() && snap.updateAvailable && snap.hasAssets && state.lastFailedVersion !== state.latestVersion) {
        return this.applyUpdate();
      }
      return { ...snap, ok: true, cached: true };
    }
    if (this.checkPending) return this.checkPending;
    this.checkPending = (async () => {
      this.busy = 'checking';
      try {
        const apiUrl = `https://api.github.com/repos/${this.repo}/releases/latest`;
        const res = await fetchVerified(apiUrl, {
          fetchImpl: this.fetchImpl,
          allowedHosts: TRUSTED_API_HOSTS,
          maxBytes: MAX_META_BYTES,
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': `Antigrative-Dashboard/${currentVersion}`,
          },
          timeoutMs: 10000,
        });
        if (res.status === 404) {
          state.checkedAt = new Date(now).toISOString();
          state.latestVersion = currentVersion;
          state.tag = `v${currentVersion}`;
          state.assetName = null;
          state.assetUrl = null;
          state.sha256Url = null;
          state.lastError = null;
          await this.persist();
          return { ...this.snapshot(), ok: true, cached: false };
        }
        if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
        const release = JSON.parse(res.bytes.toString('utf8'));
        if (!release || release.draft || release.prerelease || typeof release.tag_name !== 'string') {
          throw new Error('Invalid GitHub release metadata');
        }
        const parsed = parseVersion(release.tag_name);
        if (!parsed) throw new Error(`Unsupported release tag: ${release.tag_name}`);
        const { zip, sha256 } = selectReleaseAssets(release.assets);
        state.checkedAt = new Date(now).toISOString();
        state.latestVersion = parsed.normalized;
        state.tag = release.tag_name;
        state.releaseUrl = typeof release.html_url === 'string' && release.html_url.startsWith('https://github.com/')
          ? release.html_url
          : `https://github.com/${this.repo}/releases/tag/${encodeURIComponent(release.tag_name)}`;
        state.publishedAt = typeof release.published_at === 'string' ? release.published_at : null;
        state.assetName = zip?.name || null;
        state.assetUrl = zip?.browser_download_url || null;
        state.sha256Url = sha256?.browser_download_url || null;
        state.lastError = null;
        await this.persist();
      } catch (error) {
        state.lastError = error?.message || 'Update check failed';
        await this.persist().catch(() => {});
        return { ...this.snapshot(), ok: false, error: state.lastError };
      } finally {
        if (this.busy === 'checking') this.busy = null;
        this.checkPending = null;
      }

      const snap = this.snapshot();
      if (autoApply && state.autoUpdate && !this.isDevCheckout() && snap.updateAvailable && snap.hasAssets && state.lastFailedVersion !== state.latestVersion) {
        return this.applyUpdate();
      }
      return { ...snap, ok: true, cached: false };
    })();
    return this.checkPending;
  }

  async applyUpdate({ now = Date.now() } = {}) {
    const state = await this.load();
    if (this.isDevCheckout()) {
      return { ...this.snapshot(), ok: false, error: 'Running from a git workspace; update with git pull.' };
    }
    if (this.updatePending) return this.updatePending;
    this.updatePending = (async () => {
      if (!state.latestVersion || !state.assetUrl || !state.sha256Url) {
        const checked = await this.check({ force: true, autoApply: false, now });
        if (!checked.ok) return checked;
      }
      const currentVersion = this.readCurrentVersion();
      const targetVersion = state.latestVersion;
      if (!targetVersion || compareVersions(targetVersion, currentVersion) !== 1) {
        return { ...this.snapshot(), ok: true, updated: false };
      }
      if (!state.assetUrl || !state.sha256Url) {
        state.lastError = 'Release package or SHA256 checksum asset missing';
        state.lastFailedVersion = targetVersion;
        await this.persist().catch(() => {});
        return { ...this.snapshot(), ok: false, error: state.lastError };
      }

      this.busy = 'updating';
      let staging = null;
      try {
        // Verify destination belongs to Antigrative Dashboard before touching disk.
        const installedManifest = JSON.parse((await readFile(join(this.pluginDir, 'plugin.json'), 'utf8')).replace(/^\uFEFF/, ''));
        if (installedManifest?.name !== 'antigravity-pulse') {
          throw new Error('Destination is not an Antigrative Dashboard installation');
        }

        const headers = { 'User-Agent': `Antigrative-Dashboard/${currentVersion}` };
        const shaRes = await fetchVerified(state.sha256Url, {
          fetchImpl: this.fetchImpl,
          allowedHosts: TRUSTED_DOWNLOAD_HOSTS,
          maxBytes: 4096,
          headers,
          timeoutMs: 15000,
        });
        if (!shaRes.ok) throw new Error(`Checksum download HTTP ${shaRes.status}`);
        const expectedSha = parseSha256Text(shaRes.bytes.toString('utf8'));
        if (!expectedSha) throw new Error('Invalid SHA256 checksum file');

        const zipRes = await fetchVerified(state.assetUrl, {
          fetchImpl: this.fetchImpl,
          allowedHosts: TRUSTED_DOWNLOAD_HOSTS,
          maxBytes: MAX_ZIP_BYTES,
          headers,
          timeoutMs: 60000,
        });
        if (!zipRes.ok) throw new Error(`Package download HTTP ${zipRes.status}`);

        const actualDigest = createHash('sha256').update(zipRes.bytes).digest('hex');
        if (actualDigest !== expectedSha.digest) {
          throw new Error('Package SHA256 checksum mismatch');
        }

        const allEntries = extractZipEntries(zipRes.bytes);
        const runtimeFiles = new Map();
        for (const [entryName, data] of allEntries) {
          const rel = runtimeRelativePath(entryName);
          if (rel) runtimeFiles.set(rel, data);
        }

        const nextManifestRaw = runtimeFiles.get('plugin.json');
        if (!nextManifestRaw) throw new Error('Package missing plugin.json');
        const nextManifest = JSON.parse(nextManifestRaw.toString('utf8').replace(/^\uFEFF/, ''));
        if (nextManifest?.name !== 'antigravity-pulse') throw new Error('Package manifest name mismatch');
        if (compareVersions(nextManifest.version, targetVersion) !== 0) {
          throw new Error(`Package version ${nextManifest.version} differs from release ${targetVersion}`);
        }
        for (const required of ['sidecars/panel/main.mjs', 'compat/inline-widget.cjs', 'compat/runtime-ui.mjs']) {
          if (!runtimeFiles.has(required)) throw new Error(`Package missing required file: ${required}`);
        }

        // Stage all files in a sibling directory, then atomically replace into pluginDir.
        staging = join(dirname(this.pluginDir), `.antigravity-pulse.update-${process.pid}-${randomUUID()}`);
        await mkdir(staging, { recursive: true });
        for (const [rel, data] of runtimeFiles) {
          const stagedFile = join(staging, ...rel.split('/'));
          await mkdir(dirname(stagedFile), { recursive: true });
          await writeFile(stagedFile, data);
        }
        for (const rel of runtimeFiles.keys()) {
          const stagedFile = join(staging, ...rel.split('/'));
          const destFile = join(this.pluginDir, ...rel.split('/'));
          await mkdir(dirname(destFile), { recursive: true });
          await rename(stagedFile, destFile);
        }

        state.lastUpdatedVersion = targetVersion;
        state.lastUpdatedAt = new Date(now).toISOString();
        state.lastFailedVersion = null;
        state.lastError = null;
        this.restartPending = true;
        this.busy = null;
        await this.persist();
        const result = { ...this.snapshot(), ok: true, updated: true, from: currentVersion, to: targetVersion };
        try { this.onUpdated?.({ from: currentVersion, to: targetVersion }); } catch {}
        return result;
      } catch (error) {
        this.busy = null;
        state.lastError = error?.message || 'Update failed';
        state.lastFailedVersion = targetVersion;
        await this.persist().catch(() => {});
        return { ...this.snapshot(), ok: false, updated: false, error: state.lastError };
      } finally {
        if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
        if (this.busy === 'updating') this.busy = null;
        this.updatePending = null;
      }
    })();
    return this.updatePending;
  }

  async setAutoUpdate(enabled) {
    const state = await this.load();
    state.autoUpdate = Boolean(enabled);
    if (state.autoUpdate) state.lastFailedVersion = null;
    await this.persist();
    return { ok: true, ...this.snapshot() };
  }

  async handleAction(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid update request');
    const action = input.action || 'get';
    if (action === 'get') { await this.load(); return { ok: true, ...this.snapshot() }; }
    if (action === 'check') return this.check({ force: true, autoApply: false });
    if (action === 'apply') return this.applyUpdate();
    if (action === 'set-auto') return this.setAutoUpdate(input.autoUpdate);
    throw new Error('Unsupported update action');
  }
}
