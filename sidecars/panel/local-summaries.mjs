import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_MAP = {
  0: 'CASCADE_RUN_STATUS_UNSPECIFIED',
  1: 'CASCADE_RUN_STATUS_IDLE',
  2: 'CASCADE_RUN_STATUS_RUNNING',
  3: 'CASCADE_RUN_STATUS_WAITING_FOR_USER',
  4: 'CASCADE_RUN_STATUS_CANCELING',
};

function readVarint(buf, pos) {
  let result = 0n, shift = 0n;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7n;
    if (shift > 70n) throw new Error('Malformed varint');
  }
  throw new Error('Truncated varint');
}

function skipField(buf, pos, wireType) {
  if (wireType === 0) return readVarint(buf, pos)[1];
  if (wireType === 1) return pos + 8;
  if (wireType === 2) {
    const [len, next] = readVarint(buf, pos);
    return next + Number(len);
  }
  if (wireType === 5) return pos + 4;
  throw new Error('Unsupported wire type');
}

function decodeTimestamp(buf) {
  let pos = 0, seconds = 0n, nanos = 0;
  while (pos < buf.length) {
    const [tag, next] = readVarint(buf, pos);
    pos = next;
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (wire === 0) {
      const [val, after] = readVarint(buf, pos);
      pos = after;
      if (field === 1) seconds = val;
      else if (field === 2) nanos = Number(val);
    } else {
      pos = skipField(buf, pos, wire);
    }
  }
  const secNum = Number(seconds);
  if (!Number.isFinite(secNum) || secNum <= 0) return null;
  const iso = new Date(secNum * 1000).toISOString();
  if (!nanos) return iso;
  return iso.slice(0, 19) + '.' + String(nanos).padStart(9, '0').replace(/0+$/, '') + 'Z';
}

function decodeSummary(buf) {
  let pos = 0;
  const out = { stepCount: 0, status: 'CASCADE_RUN_STATUS_IDLE' };
  while (pos < buf.length) {
    const [tag, next] = readVarint(buf, pos);
    pos = next;
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (wire === 0) {
      const [val, after] = readVarint(buf, pos);
      pos = after;
      if (field === 2) out.stepCount = Number(val);
      else if (field === 5) out.status = STATUS_MAP[Number(val)] || `CASCADE_RUN_STATUS_${val}`;
      else if (field === 16) {
        const signed = BigInt.asIntN(32, val);
        out.lastUserInputStepIndex = Number(signed);
      }
    } else if (wire === 2) {
      const [len, after] = readVarint(buf, pos);
      const end = after + Number(len);
      const slice = buf.subarray(after, end);
      pos = end;
      if (field === 1) out.summary = slice.toString('utf8');
      else if (field === 3) {
        const ts = decodeTimestamp(slice);
        if (ts) out.lastModifiedTime = ts;
      } else if (field === 4) out.trajectoryId = slice.toString('utf8');
    } else {
      pos = skipField(buf, pos, wire);
    }
  }
  return out;
}

export function parseSummariesProto(buf) {
  const summaries = {};
  let pos = 0;
  while (pos < buf.length) {
    const [tag, next] = readVarint(buf, pos);
    pos = next;
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (field === 1 && wire === 2) {
      const [len, after] = readVarint(buf, pos);
      const end = after + Number(len);
      const entry = buf.subarray(after, end);
      pos = end;
      let epos = 0, key = null, val = null;
      while (epos < entry.length) {
        const [etag, enext] = readVarint(entry, epos);
        epos = enext;
        const efield = Number(etag >> 3n), ewire = Number(etag & 7n);
        if (ewire === 2) {
          const [elen, eafter] = readVarint(entry, epos);
          const eend = eafter + Number(elen);
          const eslice = entry.subarray(eafter, eend);
          epos = eend;
          if (efield === 1) key = eslice.toString('utf8');
          else if (efield === 2) val = decodeSummary(eslice);
        } else {
          epos = skipField(entry, epos, ewire);
        }
      }
      if (key && GUID.test(key) && val) summaries[key] = val;
    } else {
      pos = skipField(buf, pos, wire);
    }
  }
  return summaries;
}

export async function readLocalSummaries(rootDir = join(homedir(), '.gemini', 'antigravity')) {
  const summaries = {};
  let diskIds = null;
  const convDir = join(rootDir, 'conversations');
  try {
    const files = await readdir(convDir);
    diskIds = new Set();
    for (const file of files) {
      const m = file.match(/^([0-9a-f-]{36})\.(?:db|pb)$/i);
      if (m && GUID.test(m[1])) diskIds.add(m[1].toLowerCase());
    }
  } catch {}
  try {
    const buf = await readFile(join(rootDir, 'agyhub_summaries_proto.pb'));
    const parsed = parseSummariesProto(buf);
    for (const [id, summary] of Object.entries(parsed)) {
      if (summary.stepCount === 0) continue;
      if (diskIds && !diskIds.has(id.toLowerCase())) continue;
      summaries[id] = summary;
    }
  } catch {}
  if (!Object.keys(summaries).length && diskIds?.size) {
    for (const id of diskIds) {
      try {
        const info = await stat(join(convDir, `${id}.db`)).catch(() => stat(join(convDir, `${id}.pb`)));
        summaries[id] = {
          summary: '历史会话',
          lastModifiedTime: new Date(info.mtimeMs).toISOString(),
          status: 'CASCADE_RUN_STATUS_IDLE',
        };
      } catch {}
    }
  }
  return summaries;
}
