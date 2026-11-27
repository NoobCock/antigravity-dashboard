// The host estimates the prompt at request start. This is not cumulative usage
// and not a per-token live meter. Unknown capacities are never guessed by model.
const count = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

const RAW_BREAKDOWN_KEYS = {
  TOKEN_TYPE_CHAT_MESSAGES: 'chat',
  TOKEN_TYPE_TOOLS: 'tools',
  TOKEN_TYPE_SYSTEM_PROMPT: 'system',
  TOKEN_TYPE_SUBAGENTS: 'subagents',
  TOKEN_TYPE_SKILLS: 'skills',
  TOKEN_TYPE_PLUGINS: 'plugins',
  TOKEN_TYPE_MCP_TOOLS: 'mcp',
};
const ALLOWED_KEYS = new Set([...Object.values(RAW_BREAKDOWN_KEYS), 'other']);

export function normalizeBreakdown(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const totals = new Map();
  if (Array.isArray(raw.groups)) {
    for (const group of raw.groups) {
      if (!group || typeof group !== 'object') continue;
      const n = count(group.numTokens);
      if (n === null || n <= 0) continue;
      const key = RAW_BREAKDOWN_KEYS[String(group.type || '')] || 'other';
      totals.set(key, (totals.get(key) || 0) + n);
    }
  } else if (Array.isArray(raw.items)) {
    for (const item of raw.items) {
      if (!item || typeof item !== 'object') continue;
      const key = String(item.key || '');
      const n = count(item.tokens);
      if (!ALLOWED_KEYS.has(key) || n === null || n <= 0) continue;
      totals.set(key, (totals.get(key) || 0) + n);
    }
  }
  if (!totals.size) return null;
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  const rawTotal = count(raw.totalTokens);
  const totalTokens = rawTotal && rawTotal >= sum ? rawTotal : sum;
  const items = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, tokens]) => ({ key, tokens, fraction: totalTokens > 0 ? tokens / totalTokens : 0 }));
  return { totalTokens, items };
}

export function contextMetrics(metadata, { model = null, sampledAt = null, breakdown = undefined } = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const usedTokens=count(metadata.estimatedTokensUsed), rawMax=count(metadata.maxContextTokens);
  const maxTokens=rawMax > 0 ? rawMax : null;
  if (usedTokens === null) return null;
  const parsedBreakdown = normalizeBreakdown(breakdown !== undefined ? breakdown : metadata.tokenBreakdown);
  return {
    usedTokens, maxTokens, remainingTokens:maxTokens === null ? null : Math.max(0,maxTokens-usedTokens),
    usedFraction:maxTokens === null ? null : usedTokens/maxTokens,
    remainingFraction:maxTokens === null ? null : Math.max(0,1-usedTokens/maxTokens),
    model:typeof model === 'string' ? model.slice(0,256) : null,
    sampledAt:typeof sampledAt === 'string' && Number.isFinite(Date.parse(sampledAt)) ? new Date(sampledAt).toISOString() : null,
    source:'Antigravity context window metadata', estimated:true,
    ...(parsedBreakdown ? { breakdown: parsedBreakdown } : {}),
  };
}

export function safeContext(value) {
  return value && contextMetrics({estimatedTokensUsed:value.usedTokens,maxContextTokens:value.maxTokens},value);
}
