// Public API reference pricing (USD per 1,000,000 tokens) with live Google pricing fetch
// and persistent user custom overrides.
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { platformPaths } from '../../compat/platform.mjs';

export const GOOGLE_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing.md.txt';
const LIVE_TTL_MS = 6 * 3600 * 1000;
const MAX_FETCH_BYTES = 512 * 1024;
const DEC_2026 = Date.UTC(2026, 11, 1);
const JAN_2027 = Date.UTC(2027, 0, 1);

const RULES = [
  // Gemini 4 family
  {
    match: /gemini[\s_-]*4[\s_-]*neon|orchestrator\s*\(\s*neon\s*\)/i,
    family: 'gemini',
    canonical: 'Gemini 4 Neon',
    rate: () => ({ input: 3.0, output: 15.0, cacheRead: 0.15, cacheWrite: 0 }),
  },
  {
    match: /gemini[\s_-]*4[\s_-]*carbon|orchestrator\s*\(\s*carbon\s*\)/i,
    family: 'gemini',
    canonical: 'Gemini 4 Carbon',
    rate: at => (at < DEC_2026
      ? { input: 2.0, output: 10.0, cacheRead: 0.1, cacheWrite: 0 }
      : { input: 4.0, output: 20.0, cacheRead: 0.2, cacheWrite: 0 }),
  },
  {
    match: /gemini[\s_-]*4[\s_-]*argon|orchestrator\s*\(\s*argon\s*\)/i,
    family: 'gemini',
    canonical: 'Gemini 4 Argon',
    rate: at => (at < DEC_2026
      ? { input: 2.0, output: 10.0, cacheRead: 0.1, cacheWrite: 0 }
      : { input: 4.0, output: 20.0, cacheRead: 0.2, cacheWrite: 0 }),
  },
  {
    match: /gemini[\s_-]*4[\s_-]*hydrogen|orchestrator\s*\(\s*hydrogen\s*\)/i,
    family: 'gemini',
    canonical: 'Gemini 4 Hydrogen',
    rate: () => ({ input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 0 }),
  },
  // Gemini 3.x family
  {
    match: /gemini[\s_-]*3[.\s_-]*8[\s_-]*flash/i,
    family: 'gemini',
    canonical: 'Gemini 3.8 Flash',
    rate: at => (at < JAN_2027
      ? { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 }
      : { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 }),
  },
  {
    match: /gemini[\s_-]*3[.\s_-]*6[\s_-]*flash/i,
    family: 'gemini',
    canonical: 'Gemini 3.6 Flash',
    rate: at => (at < JAN_2027
      ? { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 }
      : { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 }),
  },
  {
    match: /gemini[\s_-]*3[.\s_-]*5[\s_-]*flash[\s_-]*lite/i,
    family: 'gemini',
    canonical: 'Gemini 3.5 Flash-Lite',
    rate: () => ({ input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 }),
  },
  {
    match: /gemini[\s_-]*3[.\s_-]*1[\s_-]*flash[\s_-]*lite/i,
    family: 'gemini',
    canonical: 'Gemini 3.1 Flash-Lite',
    rate: () => ({ input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0 }),
  },
  {
    match: /gemini[\s_-]*3(?:[.\s_-]*[018])?[\s_-]*pro|gemini[\s_-]*pro[\s_-]*default/i,
    family: 'gemini',
    canonical: 'Gemini 3.1 Pro',
    rate: () => ({ input: 2.0, output: 12.0, cacheRead: 0.2, cacheWrite: 0 }),
  },
  {
    match: /gemini[\s_-]*3[\s_-]*flash/i,
    family: 'gemini',
    canonical: 'Gemini 3 Flash',
    rate: () => ({ input: 0.5, output: 3.0, cacheRead: 0.05, cacheWrite: 0 }),
  },
  // Gemini 2.5 family
  {
    match: /gemini[\s_-]*2[.\s_-]*5[\s_-]*pro/i,
    family: 'gemini',
    canonical: 'Gemini 2.5 Pro',
    rate: () => ({ input: 1.25, output: 10.0, cacheRead: 0.125, cacheWrite: 0 }),
  },
  {
    match: /gemini[\s_-]*2[.\s_-]*5[\s_-]*flash[\s_-]*lite/i,
    family: 'gemini',
    canonical: 'Gemini 2.5 Flash-Lite',
    rate: () => ({ input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 }),
  },
  {
    match: /gemini[\s_-]*2[.\s_-]*5[\s_-]*flash/i,
    family: 'gemini',
    canonical: 'Gemini 2.5 Flash',
    rate: () => ({ input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 }),
  },
  // Anthropic Claude family
  {
    match: /claude[\s_-]*opus[\s_-]*5[.\s_-]*5/i,
    family: '3p',
    canonical: 'Claude Opus 5.5',
    rate: () => ({ input: 4.0, output: 20.0, cacheRead: 0.2, cacheWrite: 5.0 }),
  },
  {
    match: /claude[\s_-]*sonnet[\s_-]*5[.\s_-]*5/i,
    family: '3p',
    canonical: 'Claude Sonnet 5.5',
    rate: () => ({ input: 2.0, output: 10.0, cacheRead: 0.1, cacheWrite: 2.5 }),
  },
  {
    match: /claude[\s_-]*opus[\s_-]*4[.\s_-]*[56]/i,
    family: '3p',
    canonical: 'Claude Opus 4.6',
    rate: () => ({ input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 }),
  },
  {
    match: /claude[\s_-]*opus[\s_-]*4(?![.\s_-]*[56])/i,
    family: '3p',
    canonical: 'Claude Opus 4',
    rate: () => ({ input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 }),
  },
  {
    match: /claude[\s_-]*sonnet[\s_-]*4[.\s_-]*6/i,
    family: '3p',
    canonical: 'Claude Sonnet 4.6',
    rate: () => ({ input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 }),
  },
  {
    match: /claude[\s_-]*sonnet/i,
    family: '3p',
    canonical: 'Claude Sonnet',
    rate: () => ({ input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 }),
  },
  {
    match: /claude[\s_-]*haiku/i,
    family: '3p',
    canonical: 'Claude Haiku',
    rate: () => ({ input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 }),
  },
  // OpenAI / GPT family
  {
    match: /gpt[\s_-]*oss[\s_-]*120b/i,
    family: '3p',
    canonical: 'GPT-OSS 120B',
    rate: () => ({ input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 }),
  },
  {
    match: /gpt[\s_-]*5/i,
    family: '3p',
    canonical: 'GPT-5',
    rate: () => ({ input: 1.25, output: 10.0, cacheRead: 0.125, cacheWrite: 0 }),
  },
  {
    match: /gpt[\s_-]*4o/i,
    family: '3p',
    canonical: 'GPT-4o',
    rate: () => ({ input: 2.5, output: 10.0, cacheRead: 1.25, cacheWrite: 0 }),
  },
];

const FALLBACKS = [
  {
    match: /gemini.*flash/i,
    family: 'gemini',
    rate: at => (at < JAN_2027
      ? { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 }
      : { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 }),
  },
  {
    match: /gemini|orchestrator/i,
    family: 'gemini',
    rate: at => (at < DEC_2026
      ? { input: 2.0, output: 10.0, cacheRead: 0.1, cacheWrite: 0 }
      : { input: 4.0, output: 20.0, cacheRead: 0.2, cacheWrite: 0 }),
  },
  {
    match: /claude.*opus/i,
    family: '3p',
    rate: () => ({ input: 4.0, output: 20.0, cacheRead: 0.2, cacheWrite: 5.0 }),
  },
  {
    match: /claude/i,
    family: '3p',
    rate: () => ({ input: 2.0, output: 10.0, cacheRead: 0.1, cacheWrite: 2.5 }),
  },
  {
    match: /gpt/i,
    family: '3p',
    rate: () => ({ input: 1.25, output: 10.0, cacheRead: 0.125, cacheWrite: 0 }),
  },
];

const NON_CHAT_RE = /\b(?:tts|transcribe|translate|embedding|image|nano banana|audio|robotics|decision|live)\b/i;

function normalizeKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s*\((?:low|medium|high|xhigh|orchestrator|thinking|preview)\)\s*/gi, ' ')
    .replace(/\bpreview\b/gi, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

function parseCellSchedule(cell) {
  if (!cell || /not available|not applicable/i.test(cell)) return null;
  // Strip storage price / image-equivalent / per-minute footnotes
  const cleaned = cell
    .replace(/\$[\d.]+\s*\/\s*1,000,000 tokens per hour[\s\S]*$/i, '')
    .replace(/equivalent to[\s\S]*$/i, '')
    .replace(/\{%[\s\S]*?%\}/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const schedule = [];
  for (const m of cleaned.matchAll(/\$(\d+(?:\.\d+)?)(?:\s*\([^)]*\))?\s+through\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/gi)) {
    const price = Number(m[1]);
    const untilMs = Date.parse(`${m[2]} 23:59:59 UTC`);
    if (Number.isFinite(price) && Number.isFinite(untilMs)) schedule.push({ price, untilMs });
  }
  for (const m of cleaned.matchAll(/\$(\d+(?:\.\d+)?)(?:\s*\([^)]*\))?\s+starting\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/gi)) {
    const price = Number(m[1]);
    const fromMs = Date.parse(`${m[2]} 00:00:00 UTC`);
    if (Number.isFinite(price) && Number.isFinite(fromMs)) schedule.push({ price, fromMs });
  }
  if (schedule.length) {
    return { price: schedule[0].price, schedule };
  }
  // Standard single/tiered price: take first token price not followed by /min or per image
  for (const m of cleaned.matchAll(/\$(\d+(?:\.\d+)?)(?!\s*(?:\/\s*min|per\s+(?:image|1,000|10s)))/gi)) {
    const price = Number(m[1]);
    if (Number.isFinite(price) && price >= 0 && price <= 1000) return { price, schedule: null };
  }
  return null;
}

function evalSchedule(entry, atMs) {
  if (!entry) return null;
  const ts = Number.isFinite(atMs) ? atMs : Date.now();
  if (Array.isArray(entry.schedule) && entry.schedule.length) {
    const starts = entry.schedule.filter(s => typeof s.fromMs === 'number').sort((a, b) => b.fromMs - a.fromMs);
    for (const s of starts) if (ts >= s.fromMs) return s.price;
    const untils = entry.schedule.filter(s => typeof s.untilMs === 'number').sort((a, b) => a.untilMs - b.untilMs);
    for (const u of untils) if (ts <= u.untilMs) return u.price;
  }
  return typeof entry.price === 'number' && Number.isFinite(entry.price) ? entry.price : null;
}

export function parseGooglePricingMarkdown(markdown) {
  if (typeof markdown !== 'string' || !markdown.includes('## Gemini')) return {};
  const models = {};
  const sections = markdown.split(/\n(?=##\s+)/);
  for (const section of sections) {
    const head = section.split('\n')[0] || '';
    if (!/^##\s+Gemini/i.test(head)) continue;
    const rawTitle = head.replace(/^##\s+/, '').replace(/\s*\{%.*?%\}/g, '').replace(/[^\x20-\x7e]/g, '').trim();
    if (!rawTitle || NON_CHAT_RE.test(rawTitle)) continue;
    const id = section.match(/`([a-z0-9._-]+)`/i)?.[1] || null;
    if (id && NON_CHAT_RE.test(id)) continue;
    const std = section.match(/\{%\s*tab\s+title="Standard"\s*%\}([\s\S]*?)\{%\s*\/tab\s*%\}/)?.[1] || section;
    const table = std.match(/\{%\s*table\s*%\}([\s\S]*?)\{%\s*\/table\s*%\}/)?.[1] || '';
    if (!table) continue;
    const rows = table.split(/\n\s*---\s*\n/).map(row =>
      ('\n' + row).split(/\n[ \t]*\*[ \t]+/).slice(1).map(c => c.replace(/\s+/g, ' ').trim())
    );
    const findCell = re => {
      const row = rows.find(cols => cols[0] && re.test(cols[0]));
      return row && row.length >= 2 ? row[row.length - 1] : null;
    };
    const input = parseCellSchedule(findCell(/^Input price/i));
    const output = parseCellSchedule(findCell(/^Output price/i));
    const cacheRead = parseCellSchedule(findCell(/^Context caching/i));
    if (!input || !output) continue;
    const canonical = rawTitle.replace(/\s+Preview$/i, '').trim();
    models[canonical] = {
      canonical,
      id: id || canonical.toLowerCase().replace(/\s+/g, '-'),
      input,
      output,
      cacheRead: cacheRead || { price: Number((input.price * 0.1).toFixed(4)), schedule: null },
      cacheWrite: { price: 0, schedule: null },
    };
  }
  return models;
}

function findLiveEntry(text, liveModels) {
  if (!liveModels || typeof liveModels !== 'object') return null;
  if (liveModels[text]) return liveModels[text];
  const norm = normalizeKey(text);
  const orchMatch = text.match(/^orchestrator\s*\(\s*([^)]+)\s*\)$/i);
  const orchKey = orchMatch ? normalizeKey('gemini 4 ' + orchMatch[1]) : null;
  for (const entry of Object.values(liveModels)) {
    if (!entry?.canonical) continue;
    const cNorm = normalizeKey(entry.canonical);
    const idNorm = entry.id ? normalizeKey(entry.id) : '';
    if (norm === cNorm || (idNorm && norm === idNorm) || (orchKey && (orchKey === cNorm || orchKey === idNorm))) {
      return entry;
    }
    if (norm.startsWith(cNorm + ' ') || (idNorm && norm.startsWith(idNorm + ' '))) {
      return entry;
    }
  }
  return null;
}

function evaluateLiveEntry(entry, atMs) {
  const input = evalSchedule(entry.input, atMs);
  const output = evalSchedule(entry.output, atMs);
  const cacheRead = evalSchedule(entry.cacheRead, atMs) ?? Number(((input || 0) * 0.1).toFixed(4));
  const cacheWrite = evalSchedule(entry.cacheWrite, atMs) ?? 0;
  if (input === null || output === null) return null;
  return {
    canonical: entry.canonical,
    family: 'gemini',
    input,
    output,
    cacheRead,
    cacheWrite,
    exact: true,
    source: 'live-google',
  };
}

function validRateValue(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10000;
}

export function sanitizeOverride(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = Number(raw.input), output = Number(raw.output), cacheRead = Number(raw.cacheRead);
  const cacheWrite = raw.cacheWrite === undefined || raw.cacheWrite === null || raw.cacheWrite === '' ? 0 : Number(raw.cacheWrite);
  if (![input, output, cacheRead, cacheWrite].every(validRateValue)) return null;
  return {
    input: Number(input.toFixed(4)),
    output: Number(output.toFixed(4)),
    cacheRead: Number(cacheRead.toFixed(4)),
    cacheWrite: Number(cacheWrite.toFixed(4)),
  };
}

export function resolveModelPricing(model, atMs = Date.now(), options = null) {
  const { overrides = null, liveModels = null } = options || {};
  if (typeof model !== 'string' || !model.trim()) return null;
  const text = model.trim();
  const timestamp = Number.isFinite(atMs) ? atMs : Date.now();

  let base = null;
  const liveEntry = findLiveEntry(text, liveModels);
  if (liveEntry) {
    base = evaluateLiveEntry(liveEntry, timestamp);
  }
  if (!base) {
    for (const rule of RULES) {
      if (rule.match.test(text)) {
        base = {
          canonical: rule.canonical,
          family: rule.family,
          ...rule.rate(timestamp),
          exact: true,
          source: 'builtin',
        };
        break;
      }
    }
  }
  if (!base) {
    for (const fallback of FALLBACKS) {
      if (fallback.match.test(text)) {
        base = {
          canonical: text.replace(/\s*\((?:low|medium|high|xhigh|orchestrator|thinking)\)\s*$/i, '').trim() || text,
          family: fallback.family,
          ...fallback.rate(timestamp),
          exact: false,
          source: 'fallback',
        };
        break;
      }
    }
  }

  const canonical = base?.canonical || text;
  const overrideRaw = overrides?.[canonical] || overrides?.[text];
  const override = sanitizeOverride(overrideRaw);
  if (override) {
    return {
      canonical,
      family: base?.family || (/gemini|orchestrator/i.test(text) ? 'gemini' : '3p'),
      ...override,
      exact: true,
      source: 'custom',
      hasOverride: true,
      defaultPricing: base ? { input: base.input, output: base.output, cacheRead: base.cacheRead, cacheWrite: base.cacheWrite, source: base.source } : null,
    };
  }
  if (!base) return null;
  return {
    ...base,
    hasOverride: false,
    defaultPricing: { input: base.input, output: base.output, cacheRead: base.cacheRead, cacheWrite: base.cacheWrite, source: base.source },
  };
}

const VARIANT_PARENS_RE = /\s*\((?:low|medium|high|xhigh|max|min|minimal|thinking|orchestrator|control|trial|tiered|preview|default|fast|exp|experimental)\)\s*$/i;
const VARIANT_SUFFIX_RE = /(?:[\s_-]+(?:n|control|trial|tiered|preview|latest|default|low|medium|high|xhigh|max|min|minimal|thinking|orchestrator|exp|experimental|20\d{6}|\d{3}))+$/i;
const TITLE_WORDS = new Map([
  ['gemini', 'Gemini'], ['claude', 'Claude'], ['gpt', 'GPT'], ['oss', 'OSS'], ['openai', 'OpenAI'],
  ['flash', 'Flash'], ['pro', 'Pro'], ['lite', 'Lite'], ['ultra', 'Ultra'], ['nano', 'Nano'], ['mini', 'Mini'], ['omni', 'Omni'],
  ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'],
  ['carbon', 'Carbon'], ['argon', 'Argon'], ['neon', 'Neon'], ['hydrogen', 'Hydrogen'],
]);

export function canonicalModelName(model, pricingOptions = null) {
  if (typeof model !== 'string' || !model.trim()) return 'Unknown';
  const raw = model.trim();
  const pricing = resolveModelPricing(raw, Date.now(), pricingOptions);
  if (pricing?.exact && pricing.canonical) return pricing.canonical;

  let text = raw;
  while (VARIANT_PARENS_RE.test(text)) text = text.replace(VARIANT_PARENS_RE, '').trim();
  const stripped = text.replace(VARIANT_SUFFIX_RE, '').trim();
  if (stripped) text = stripped;

  // Normalize slug separators while preserving GPT-OSS and Flash-Lite
  text = text
    .replace(/[_-]+/g, ' ')
    .replace(/\b(\d+)\s+(\d+)\b/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.split(' ').map(token => {
    const low = token.toLowerCase();
    if (TITLE_WORDS.has(low)) return TITLE_WORDS.get(low);
    if (/^\d+[a-z]$/i.test(token)) return token.toUpperCase();
    return /^[a-z]+$/.test(token) ? token[0].toUpperCase() + token.slice(1) : token;
  }).join(' ');
  text = text
    .replace(/\bGPT OSS\b/g, 'GPT-OSS')
    .replace(/\bFlash Lite\b/g, 'Flash-Lite');
  return text || raw;
}

export function modelEffortTier(model) {
  if (typeof model !== 'string' || !model.trim()) return 'default';
  const text = model.trim();
  if (/\borchestrator\b/i.test(text)) return 'orchestrator';
  if (/\(\s*max\s*\)|(?:^|[\s_-])max(?=$|[\s_-])/i.test(text)) return 'max';
  if (/\(\s*(?:xhigh|extra[\s_-]*high)\s*\)|(?:^|[\s_-])(?:xhigh|extra[\s_-]*high)(?=$|[\s_-])/i.test(text)) return 'xhigh';
  if (/\(\s*high\s*\)|(?:^|[\s_-])high(?=$|[\s_-])/i.test(text)) return 'high';
  if (/\(\s*medium\s*\)|(?:^|[\s_-])medium(?=$|[\s_-])/i.test(text)) return 'medium';
  if (/\(\s*low\s*\)|(?:^|[\s_-])low(?=$|[\s_-])/i.test(text)) return 'low';
  if (/\(\s*(?:min|minimal|none)\s*\)|(?:^|[\s_-])(?:min|minimal)(?=$|[\s_-])/i.test(text)) return 'minimal';
  if (/\(\s*thinking\s*\)|(?:^|[\s_-])thinking(?=$|[\s_-])/i.test(text)) return 'thinking';
  return 'default';
}

export function tokenCostUsd(counts, pricing) {
  if (!counts || !pricing) return 0;
  const uncached = Math.max(0, Number(counts.uncached) || 0);
  const cacheRead = Math.max(0, Number(counts.cacheRead) || 0);
  const cacheWrite = Math.max(0, Number(counts.cacheWrite) || 0);
  const output = Math.max(0, Number(counts.output) || 0);
  const writeRate = pricing.cacheWrite > 0 ? pricing.cacheWrite : pricing.input;
  return (uncached * pricing.input + cacheRead * pricing.cacheRead + cacheWrite * writeRate + output * pricing.output) / 1e6;
}

export function blendedCostPer1M(pricing, shares) {
  if (!pricing || !shares) return null;
  const writeRate = pricing.cacheWrite > 0 ? pricing.cacheWrite : pricing.input;
  const cost = (shares.uncached || 0) * pricing.input
    + (shares.cacheRead || 0) * pricing.cacheRead
    + (shares.cacheWrite || 0) * writeRate
    + (shares.output || 0) * pricing.output;
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

export function modelBelongsToGroup(model, group, pricingOptions) {
  if (typeof model !== 'string' || !model.trim() || !group) return false;
  const id = String(group.id || '').toLowerCase();
  const name = String(group.name || '').toLowerCase();
  const description = String(group.description || '');
  const pricing = resolveModelPricing(model, Date.now(), pricingOptions);
  if (/gemini/.test(id) || /gemini/.test(name)) {
    return pricing?.family === 'gemini' || /gemini|orchestrator/i.test(model);
  }
  if (/3p|claude|gpt/.test(id) || /claude|gpt/.test(name)) {
    return pricing?.family === '3p' || /claude|gpt|openai|anthropic/i.test(model);
  }
  if (description) {
    const canonical = (pricing?.canonical || model).toLowerCase();
    if (description.toLowerCase().includes(canonical)) return true;
  }
  return false;
}

export function groupReferenceModels(group, atMs = Date.now(), pricingOptions) {
  const seen = new Map();
  const add = name => {
    const pricing = resolveModelPricing(name, atMs, pricingOptions);
    if (pricing && !seen.has(pricing.canonical)) seen.set(pricing.canonical, pricing);
  };
  const description = String(group?.description || '');
  const listMatch = description.match(/models within this group:\s*(.+)$/i);
  if (listMatch) {
    for (const part of listMatch[1].split(',')) add(part.trim());
  }
  const id = String(group?.id || '').toLowerCase();
  const name = String(group?.name || '').toLowerCase();
  if (!seen.size) {
    if (/gemini/.test(id) || /gemini/.test(name)) {
      for (const m of ['Gemini 4 Neon', 'Gemini 4 Carbon', 'Gemini 4 Argon', 'Gemini 4 Hydrogen', 'Gemini 3.8 Flash']) add(m);
    } else if (/3p|claude|gpt/.test(id) || /claude|gpt/.test(name)) {
      for (const m of ['Claude Opus 5.5', 'Claude Sonnet 5.5', 'GPT-OSS 120B']) add(m);
    }
  }
  return [...seen.values()];
}

export class PricingStore {
  constructor(file = join(platformPaths().data, 'pricing-config.json'), { fetchImpl = globalThis.fetch, url = GOOGLE_PRICING_URL, ttlMs = LIVE_TTL_MS } = {}) {
    this.file = file;
    this.fetchImpl = fetchImpl;
    this.url = url;
    this.ttlMs = ttlMs;
    this.state = null;
    this.writeQueue = Promise.resolve();
    this.livePending = null;
    this.liveError = null;
  }

  async load() {
    if (this.state) return this.state;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'));
      if (raw?.schema === 1) {
        const overrides = {};
        for (const [k, v] of Object.entries(raw.overrides || {})) {
          const clean = sanitizeOverride(v);
          if (clean && typeof k === 'string' && k.trim() && k.length <= 120) overrides[k.trim()] = clean;
        }
        const live = raw.live && typeof raw.live === 'object' && raw.live.models && typeof raw.live.models === 'object'
          ? { source: String(raw.live.source || this.url), fetchedAt: raw.live.fetchedAt || null, models: raw.live.models }
          : { source: this.url, fetchedAt: null, models: {} };
        this.state = { schema: 1, overrides, live };
        return this.state;
      }
    } catch {}
    this.state = { schema: 1, overrides: {}, live: { source: this.url, fetchedAt: null, models: {} } };
    return this.state;
  }

  async persist() {
    if (!this.state) return;
    const payload = JSON.stringify(this.state);
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(join(this.file, '..'), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, payload, { mode: 0o600 });
        await rename(temp, this.file);
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error;
      }
    });
    return this.writeQueue;
  }

  async options() {
    const state = await this.load();
    return { overrides: state.overrides, liveModels: state.live.models };
  }

  async meta() {
    const state = await this.load();
    return {
      liveFetchedAt: state.live.fetchedAt || null,
      liveModelCount: Object.keys(state.live.models || {}).length,
      liveSource: state.live.source || this.url,
      liveError: this.liveError,
      overrideCount: Object.keys(state.overrides || {}).length,
    };
  }

  async snapshot() {
    const state = await this.load();
    return {
      overrides: { ...state.overrides },
      ...(await this.meta()),
    };
  }

  async refreshLive({ force = false, now = Date.now() } = {}) {
    const state = await this.load();
    const lastMs = state.live.fetchedAt ? Date.parse(state.live.fetchedAt) : NaN;
    if (!force && Number.isFinite(lastMs) && now - lastMs < this.ttlMs && Object.keys(state.live.models || {}).length > 0) {
      return { ok: true, cached: true, ...(await this.snapshot()) };
    }
    if (this.livePending) return this.livePending;
    this.livePending = (async () => {
      try {
        if (typeof this.fetchImpl !== 'function') throw new Error('Fetch unavailable');
        const response = await this.fetchImpl(this.url, {
          headers: { 'User-Agent': 'Antigrative-Dashboard/0.8.5' },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (text.length > MAX_FETCH_BYTES) throw new Error('Pricing document too large');
        const parsed = parseGooglePricingMarkdown(text);
        const count = Object.keys(parsed).length;
        if (!count) throw new Error('No Gemini pricing entries parsed');
        state.live = {
          source: this.url,
          fetchedAt: new Date(now).toISOString(),
          models: parsed,
        };
        this.liveError = null;
        await this.persist();
        return { ok: true, cached: false, ...(await this.snapshot()) };
      } catch (error) {
        this.liveError = error?.message || 'Fetch failed';
        return { ok: false, error: this.liveError, ...(await this.snapshot()) };
      } finally {
        this.livePending = null;
      }
    })();
    return this.livePending;
  }

  async setOverride(model, rates) {
    const state = await this.load();
    if (typeof model !== 'string' || !model.trim() || model.length > 120) throw new Error('Invalid model name');
    const clean = sanitizeOverride(rates);
    if (!clean) throw new Error('Invalid pricing values');
    state.overrides[model.trim()] = clean;
    await this.persist();
    return { ok: true, ...(await this.snapshot()) };
  }

  async clearOverride(model) {
    const state = await this.load();
    if (typeof model !== 'string' || !model.trim()) throw new Error('Invalid model name');
    delete state.overrides[model.trim()];
    await this.persist();
    return { ok: true, ...(await this.snapshot()) };
  }

  async resetAllOverrides() {
    const state = await this.load();
    state.overrides = {};
    await this.persist();
    return { ok: true, ...(await this.snapshot()) };
  }

  async handleAction(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid pricing request');
    const action = input.action || 'get';
    if (action === 'get') return this.snapshot();
    if (action === 'refresh-live') return this.refreshLive({ force: true });
    if (action === 'set-override') return this.setOverride(input.model, input);
    if (action === 'clear-override') return this.clearOverride(input.model);
    if (action === 'reset-all') return this.resetAllOverrides();
    throw new Error('Unsupported pricing action');
  }
}
