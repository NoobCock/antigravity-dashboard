// Pure transforms. No credentials, prompts, or message text enter the public result.
import { contextMetrics } from './context.mjs';
import { classifyRates, RATE_VERSION, RATE_REASONS } from './rate-quality.mjs';
export function seconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^\d+(?:\.\d+)?s$/.test(value)) {
    const n = Number(value.slice(0, -1));
    return Number.isFinite(n) ? n : null;
  }
  if (value && typeof value === 'object') {
    if (value.seconds === undefined && value.nanos === undefined) return null;
    const whole = Number(value.seconds ?? 0), nanos = Number(value.nanos ?? 0);
    if (!Number.isSafeInteger(whole) || whole < 0 || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) return null;
    const n = whole + nanos / 1e9;
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

export function tokenCount(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function requestCacheMetrics(usage) {
  const input = tokenCount(usage.inputTokens);
  if ((usage.cacheReadTokens !== undefined && tokenCount(usage.cacheReadTokens) === null) ||
      (usage.cacheWriteTokens !== undefined && tokenCount(usage.cacheWriteTokens) === null)) return null;
  const read = tokenCount(usage.cacheReadTokens) ?? 0;
  const write = tokenCount(usage.cacheWriteTokens) ?? 0;
  const provider = String(usage.apiProvider || '');
  if (input === null || !/GOOGLE_GEMINI|OPENAI|ANTHROPIC/.test(provider)) return null;
  // Antigravity ModelUsageStats normalizes inputTokens to uncached input,
  // including Gemini (verified against live records with cacheRead > input).
  // These are NOT upstream Gemini/OpenAI prompt_tokens. Add the separate
  // cache read/write counts exactly once for this local interface.
  const total = input + read + write;
  if (!Number.isSafeInteger(total) || total <= 0 || read + write > total) return null;
  return { inputTokens:total, cachedTokens:read, cacheWriteTokens:write, uncachedTokens:total-read-write };
}

function unionSeconds(intervals) {
  const sorted = intervals.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a).sort((a, b) => a[0] - b[0]);
  let total = 0, start = null, end = null;
  for (const [a, b] of sorted) {
    if (start === null) { start = a; end = b; }
    else if (a <= end) end = Math.max(end, b);
    else { total += end - start; start = a; end = b; }
  }
  if (start !== null) total += end - start;
  return total / 1000;
}

function utf8ByteLength(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  return null;
}

function rawValueStringBytes(val) {
  if (typeof val === 'string') return Buffer.byteLength(val, 'utf8');
  if (Array.isArray(val)) return val.reduce((s, item) => s + rawValueStringBytes(item), 0);
  if (val && typeof val === 'object') return Object.values(val).reduce((s, v) => s + rawValueStringBytes(v), 0);
  return 0;
}

function plannerStreamBytes(pr) {
  if (!pr || typeof pr !== 'object') return 0;
  if (typeof pr.streamBytes === 'number' && Number.isFinite(pr.streamBytes) && pr.streamBytes >= 0) return pr.streamBytes;
  return (utf8ByteLength(pr.thinking) || 0) + (utf8ByteLength(pr.response) || 0) + rawValueStringBytes(pr.toolCalls);
}

function isCompletedCheckpoint(step) {
  if (!/CHECKPOINT/i.test(String(step?.type || ''))) return false;
  const status = String(step?.status || '');
  if (status) return /DONE|COMPLETED/i.test(status);
  return Boolean(step?.metadata?.completedAt || step?.checkpoint);
}

function checkpointSummaryTokens(step) {
  const usage = step?.metadata?.modelUsage;
  if (usage && typeof usage === 'object') {
    const out = tokenCount(usage.outputTokens);
    const vis = tokenCount(usage.responseOutputTokens);
    const think = tokenCount(usage.thinkingOutputTokens);
    const response = vis ?? (out !== null && think !== null ? Math.max(0, out - think) : out);
    if (response !== null && response > 0) return response;
  }
  const bytes = utf8ByteLength(step?.checkpoint?.sessionSummary);
  if (bytes !== null && bytes > 0) return Math.ceil(bytes / 4);
  return null;
}

function latestBreakdown(generators, lastChat) {
  return lastChat?.chatStartMetadata?.contextWindowMetadata?.tokenBreakdown
    || [...generators].reverse().find(g => g?.chatModel?.chatStartMetadata?.contextWindowMetadata?.tokenBreakdown)
      ?.chatModel?.chatStartMetadata?.contextWindowMetadata?.tokenBreakdown
    || null;
}

function systemBreakdownGroups(generators, lastChat) {
  const breakdown = latestBreakdown(generators, lastChat);
  const groups = breakdown?.groups;
  if (!Array.isArray(groups) || !groups.length) return null;
  return groups.filter(group => group && typeof group === 'object' && String(group.type || '') !== 'TOKEN_TYPE_CHAT_MESSAGES');
}

function systemBreakdownTokens(generators, lastChat) {
  const groups = systemBreakdownGroups(generators, lastChat);
  if (!groups) return null;
  let sum = 0, found = false;
  for (const group of groups) {
    const n = tokenCount(group.numTokens);
    if (n !== null) { sum += n; found = true; }
  }
  return found ? sum : null;
}

function latestContext(steps, generators, lastGen, lastChat) {
  const rawMeta = lastChat?.chatStartMetadata?.contextWindowMetadata;
  const model = lastChat?.modelDisplayName || lastChat?.responseModel || String(lastChat?.model || '');
  const rawBreakdown = latestBreakdown(generators, lastChat);
  const baseContext = contextMetrics(rawMeta, { model, sampledAt: lastChat?.chatStartMetadata?.createdAt, breakdown: rawBreakdown });
  if (!rawMeta || !Array.isArray(steps) || !steps.length) return baseContext;

  let cpIndex = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (isCompletedCheckpoint(steps[i])) { cpIndex = i; break; }
  }
  if (cpIndex < 0) return baseContext;
  const cpStep = steps[cpIndex];

  const genSteps = (lastGen?.stepIndices || []).filter(i => Number.isInteger(i) && i >= 0);
  const lastGenMaxStep = genSteps.length ? Math.max(...genSteps) : -1;
  const lastGenCpIdx = Number.isInteger(lastChat?.chatStartMetadata?.checkpointIndex) ? lastChat.chatStartMetadata.checkpointIndex : null;
  const stepCpIdx = Number.isInteger(cpStep?.checkpoint?.checkpointIndex) ? cpStep.checkpoint.checkpointIndex : null;
  const lastGenStartStep = tokenCount(lastChat?.chatStartMetadata?.startStepIndex);

  let afterLastGen = false;
  if (lastGenMaxStep >= 0) {
    afterLastGen = cpIndex > lastGenMaxStep;
  } else if (lastGenCpIdx !== null && stepCpIdx !== null) {
    afterLastGen = stepCpIdx > lastGenCpIdx;
  } else if (lastGenStartStep !== null) {
    afterLastGen = cpIndex > lastGenStartStep;
  } else {
    const cpAt = Date.parse(cpStep?.metadata?.completedAt || cpStep?.metadata?.createdAt || '');
    const chatAt = Date.parse(lastChat?.chatStartMetadata?.createdAt || '');
    afterLastGen = Number.isFinite(cpAt) && Number.isFinite(chatAt) && cpAt > chatAt
      && !steps.slice(cpIndex + 1).some(s => /PLANNER_RESPONSE/.test(String(s?.type || '')));
  }
  if (!afterLastGen) return baseContext;

  const sysGroups = systemBreakdownGroups(generators, lastChat);
  const sysTokens = systemBreakdownTokens(generators, lastChat);
  const summaryTokens = checkpointSummaryTokens(cpStep);
  if (sysTokens === null && summaryTokens === null) return null;
  const combined = (sysTokens ?? 0) + (summaryTokens ?? 0);
  const preUsed = tokenCount(rawMeta.estimatedTokensUsed);
  const usedTokens = preUsed !== null ? Math.min(preUsed, combined) : combined;
  const compactGroups = [
    ...(sysGroups || []),
    ...(summaryTokens ? [{ type: 'TOKEN_TYPE_CHAT_MESSAGES', numTokens: summaryTokens }] : []),
  ];
  return contextMetrics(
    { estimatedTokensUsed: usedTokens, maxContextTokens: rawMeta.maxContextTokens },
    {
      model,
      sampledAt: cpStep?.metadata?.completedAt || cpStep?.metadata?.createdAt || lastChat?.chatStartMetadata?.createdAt,
      breakdown: compactGroups.length ? { totalTokens: usedTokens, groups: compactGroups } : null,
    },
  );
}

export function trajectoryMetrics(response) {
  const trajectory = response.trajectory || {};
  const generators = trajectory.generatorMetadata || [];
  const samples = [], ids = new Map();
  const steps = trajectory.steps || [];
  const counts = { input: 0, output: 0, responseOutput: 0, thinkingOutput: 0, cacheRead: 0, cacheWrite: 0 };
  let modelSeconds = 0, ttftSeconds = 0, ttftSamples = 0, missingTiming = 0;
  const cache = { inputTokens:0, cachedTokens:0, cacheWriteTokens:0, uncachedTokens:0, outputTokens:0, measuredRequests:0, missingRequests:0 };
  for (const [index, generator] of generators.entries()) {
    const chat = generator.chatModel;
    if (!chat?.usage) continue;
    const usage = chat.usage;
    // IDE executionId identifies a planner run/turn, not an individual model
    // request: tool follow-ups share it while having distinct responseIds.
    // Never collapse those follow-ups, even when no request ID was returned.
    const id = usage.responseId ? `response:${usage.apiProvider||''}:${usage.responseId}`
      : usage.messageId ? `message:${usage.messageId}` : `index:${index}`;
    const signature = JSON.stringify([usage.outputTokens,usage.responseOutputTokens,usage.thinkingOutputTokens,
      seconds(chat.streamingDuration),seconds(chat.timeToFirstToken),chat.responseModel,chat.model,usage.model]);
    if (ids.has(id)) {
      const previous = ids.get(id);
      if (previous.signature !== signature && !previous.sample.reasons.includes('duplicate-scope')) previous.sample.reasons.push('duplicate-scope');
      continue;
    }
    const cached = requestCacheMetrics(usage);
    if(cached) {
      for(const key of ['inputTokens','cachedTokens','cacheWriteTokens','uncachedTokens'])cache[key]+=cached[key];
      cache.outputTokens+=tokenCount(usage.outputTokens)??0;
      cache.measuredRequests++;
    } else cache.missingRequests++;
    const output = tokenCount(usage.outputTokens);
    const visible = tokenCount(usage.responseOutputTokens);
    const thinking = tokenCount(usage.thinkingOutputTokens);
    // Gemini may finish thinking before the first visible streaming token. Pair the
    // response token count with streamingDuration; do not charge thinking to that span.
    const responseTokens = visible ?? (output !== null && thinking !== null ? Math.max(0, output - thinking) : output);
    const duration = seconds(chat.streamingDuration);
    const ttft = seconds(chat.timeToFirstToken);
    counts.input += tokenCount(usage.inputTokens) ?? 0;
    counts.output += output ?? 0;
    counts.responseOutput += responseTokens ?? 0;
    counts.thinkingOutput += thinking ?? 0;
    counts.cacheRead += tokenCount(usage.cacheReadTokens) ?? 0;
    counts.cacheWrite += tokenCount(usage.cacheWriteTokens) ?? 0;
    if (ttft !== null) { ttftSeconds += ttft; ttftSamples++; }
    modelSeconds += (ttft ?? 0) + (duration ?? 0);
    const reasons = [];
    if (['outputTokens','responseOutputTokens','thinkingOutputTokens'].some(key=>usage[key] !== undefined && tokenCount(usage[key]) === null) ||
        output !== null && (visible !== null && visible > output || thinking !== null && thinking > output ||
          visible !== null && thinking !== null && visible + thinking > output)) reasons.push('token-scope');
    // One retryInfos entry is the ordinary attempt record, not evidence of a retry.
    // Multiple differing usage records lack attempt-specific timing in this API.
    const attempts = (Array.isArray(chat.retryInfos) ? chat.retryInfos : []).filter(info=>info?.usage);
    if (attempts.length > 1 && attempts.some(info=>['outputTokens','responseOutputTokens','thinkingOutputTokens'].some(key=>
        tokenCount(info.usage[key]) !== tokenCount(usage[key])))) reasons.push('retry-scope');
    const planners = (generator.stepIndices || []).map(i=>Number.isInteger(i) && i >= 0 ? steps[i] : null)
      .filter(step=>/PLANNER_RESPONSE/.test(String(step?.type || '')));
    const toolOnly = planners.length > 0 && planners.every(step=>step.plannerResponse?.toolCalls?.length > 0 &&
      !String(step.plannerResponse?.response || '').trim());
    const basis = visible !== null || thinking !== null ? 'response' : 'all-output';
    const totalOut = output ?? ((responseTokens ?? 0) + (thinking ?? 0));
    let fullGenSeconds = null;
    for (const p of planners) {
      const vMs = Date.parse(p?.metadata?.viewableAt || '');
      const fMs = Date.parse(p?.metadata?.finishedGeneratingAt || '');
      if (Number.isFinite(vMs) && Number.isFinite(fMs) && fMs - vMs >= 250) {
        fullGenSeconds = (fullGenSeconds ?? 0) + (fMs - vMs) / 1000;
      }
    }
    if (fullGenSeconds !== null && duration !== null) fullGenSeconds = Math.max(fullGenSeconds, duration);
    if (fullGenSeconds === null) {
      if ((thinking ?? 0) > 0 && ttft !== null && ttft > 0) fullGenSeconds = ttft + (duration ?? 0);
      else if (duration !== null && duration > 0) fullGenSeconds = duration;
    }
    const outputTps = totalOut !== null && totalOut > 0 && fullGenSeconds !== null && fullGenSeconds >= 0.25 && fullGenSeconds < 7200
      ? totalOut / fullGenSeconds
      : null;
    const sample = { responseTokens, totalOut, fullGenSeconds, outputTps, duration, ttft, reasons, toolOnly,
      tps: responseTokens !== null && duration > 0 ? responseTokens / duration : null,
      model: chat.modelDisplayName || chat.responseModel || String(chat.model || usage.model || ''), basis,
      profile: JSON.stringify([usage.apiProvider || '',chat.responseModel || usage.model || chat.model || chat.modelDisplayName || '',basis]) };
    samples.push(sample);
    ids.set(id,{signature,sample});
  }
  classifyRates(samples);
  const accepted = samples.filter(sample=>sample.status === 'ok');
  missingTiming = samples.filter(sample=>sample.status === 'missing' && sample.responseTokens > 0).length;
  const excludedTiming = samples.filter(sample=>sample.status === 'unreliable').length;
  const rateWarnings = samples.filter(sample=>sample.status === 'ok' && (sample.duration < 1 || sample.outlier)).length;
  const timingReasons = Object.fromEntries(RATE_REASONS.map(reason=>[reason,samples.filter(sample=>sample.reasons.includes(reason)).length]));
  const streamingSeconds = accepted.reduce((sum, s) => sum + s.duration, 0);
  const sampledTokens = accepted.reduce((sum, s) => sum + s.responseTokens, 0);
  const basisSamples = accepted.length ? accepted : samples;
  const PLANNER_STEP_RE = /PLANNER_RESPONSE/i;
  const TOOL_STEP_RE = /SEARCH_WEB|BROWSE|RUN_COMMAND|COMMAND|READ|WRITE|EDIT|CODE_ACTION|TOOL|MCP|LIST|GREP|VIEW|FIND|TERMINAL/i;
  const ACTIVE_PLANNER_STATUS_RE = /RUNNING|IN_PROGRESS|GENERATING|STREAMING|PENDING/i;
  const ACTIVE_TOOL_STATUS_RE = /RUNNING|EXECUTING|IN_PROGRESS/i;
  const SETTLED_STEP_STATUS_RE = /DONE|COMPLETED|CLEARED|CANCELLED|CANCELED|STOPPED|FAILED|ERROR|SKIPPED/i;
  const isPlannerStep = s => PLANNER_STEP_RE.test(String(s?.type || ''));
  const isToolStep = s => !isPlannerStep(s) && (TOOL_STEP_RE.test(String(s?.type || '')) || Boolean(s?.metadata?.toolCall));
  const tools = steps.filter(isToolStep);
  const completedToolIntervals = tools.map(s => [Date.parse(s.metadata?.startedAt || s.metadata?.createdAt), Date.parse(s.metadata?.completedAt)]);
  const toolSeconds = unionSeconds(completedToolIntervals);
  const isRunning = /RUNNING|EXECUTING|IN_PROGRESS/i.test(String(response.status || ''));
  let activeToolStartedAt = null, activeModelStartedAt = null, liveStream = null;
  if (isRunning) {
    let lastGenStep = -1;
    for (const g of generators) {
      if (!g?.chatModel?.usage) continue;
      for (const idx of g.stepIndices || []) {
        if (Number.isInteger(idx) && idx > lastGenStep) lastGenStep = idx;
      }
    }
    let lastUserInputStep = -1;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (/USER_INPUT/i.test(String(steps[i]?.type || ''))) { lastUserInputStep = i; break; }
    }
    // Active model thinking/generation always takes precedence over concurrent
    // background tools or queued tool calls created mid-stream.
    let activePlannerIdx = -1;
    for (let i = steps.length - 1; i > lastUserInputStep; i--) {
      const s = steps[i];
      if (!isPlannerStep(s)) continue;
      const statusStr = String(s?.status || '');
      const finishedMs = Date.parse(s?.metadata?.finishedGeneratingAt || '');
      const completedMs = Date.parse(s?.metadata?.completedAt || '');
      if (ACTIVE_PLANNER_STATUS_RE.test(statusStr) && !Number.isFinite(finishedMs) && !Number.isFinite(completedMs)) {
        activePlannerIdx = i;
      }
      break;
    }
    if (activePlannerIdx >= 0) {
      const s = steps[activePlannerIdx];
      let modelStartMs = Date.parse(s.metadata?.createdAt || s.metadata?.startedAt || s.metadata?.viewableAt || '');
      if (!Number.isFinite(modelStartMs)) {
        for (let j = activePlannerIdx - 1; j > lastUserInputStep; j--) {
          const prev = steps[j];
          const ts = Date.parse(prev?.metadata?.completedAt || prev?.metadata?.finishedGeneratingAt || prev?.metadata?.startedAt || prev?.metadata?.createdAt || '');
          if (Number.isFinite(ts)) { modelStartMs = ts; break; }
        }
      }
      if (Number.isFinite(modelStartMs)) activeModelStartedAt = new Date(modelStartMs).toISOString();
      const bytes = plannerStreamBytes(s.plannerResponse);
      const streamStart = s.metadata?.viewableAt || s.metadata?.createdAt || null;
      liveStream = {
        stepIndex: activePlannerIdx,
        startedAt: streamStart && Number.isFinite(Date.parse(streamStart)) ? new Date(streamStart).toISOString() : null,
        bytes,
        hasFirstToken: Boolean(s.metadata?.viewableAt || bytes > 0),
      };
    } else {
      const maxCompletedToolEnd = completedToolIntervals.reduce((max, [, end]) => Number.isFinite(end) ? Math.max(max, end) : max, 0);
      const activeToolStarts = [];
      for (let i = lastUserInputStep + 1; i < steps.length; i++) {
        const s = steps[i];
        if (!isToolStep(s)) continue;
        if (Number.isFinite(Date.parse(s.metadata?.completedAt || ''))) continue;
        const statusStr = String(s.status || '');
        if (SETTLED_STEP_STATUS_RE.test(statusStr)) continue;
        const startedMs = Date.parse(s.metadata?.startedAt || '');
        const createdMs = Date.parse(s.metadata?.createdAt || '');
        if (Number.isFinite(startedMs)) {
          activeToolStarts.push(startedMs);
        } else if (ACTIVE_TOOL_STATUS_RE.test(statusStr) && Number.isFinite(createdMs)) {
          activeToolStarts.push(createdMs);
        }
      }
      if (activeToolStarts.length) {
        const startMs = Math.max(Math.min(...activeToolStarts), maxCompletedToolEnd);
        activeToolStartedAt = new Date(startMs).toISOString();
      } else {
        let modelStartMs = NaN;
        for (let i = steps.length - 1; i > lastUserInputStep; i--) {
          const s = steps[i];
          if (!isPlannerStep(s)) continue;
          const statusStr = String(s?.status || '');
          const plannerSettled = SETTLED_STEP_STATUS_RE.test(statusStr)
            || Number.isFinite(Date.parse(s?.metadata?.finishedGeneratingAt || ''))
            || Number.isFinite(Date.parse(s?.metadata?.completedAt || ''));
          if (i > lastGenStep && !plannerSettled) {
            const ts = Date.parse(s.metadata?.createdAt || s.metadata?.startedAt || s.metadata?.viewableAt || '');
            if (Number.isFinite(ts)) modelStartMs = ts;
          }
          break;
        }
        if (!Number.isFinite(modelStartMs)) {
          for (let i = steps.length - 1; i > lastUserInputStep; i--) {
            const s = steps[i];
            const ts = Date.parse(s?.metadata?.completedAt || s?.metadata?.finishedGeneratingAt || s?.metadata?.startedAt || s?.metadata?.createdAt || '');
            if (Number.isFinite(ts)) { modelStartMs = ts; break; }
          }
        }
        if (Number.isFinite(modelStartMs)) activeModelStartedAt = new Date(modelStartMs).toISOString();
      }
    }
  }
  const outputSamples = samples.filter(s => typeof s.outputTps === 'number' && Number.isFinite(s.outputTps) && s.outputTps > 0 && s.outputTps < 2000 && !s.reasons.includes('duplicate-scope') && !s.reasons.includes('retry-scope') && !s.reasons.includes('token-scope'));
  const totalGenSeconds = outputSamples.reduce((sum, s) => sum + s.fullGenSeconds, 0);
  const totalGenTokens = outputSamples.reduce((sum, s) => sum + s.totalOut, 0);
  const outputTps = totalGenSeconds > 0 ? totalGenTokens / totalGenSeconds : null;
  const latestOutputSample = outputSamples.at(-1) || null;
  const latestOutputTps = latestOutputSample ? latestOutputSample.outputTps : null;
  const tpsHistory = (outputSamples.length ? outputSamples : accepted).slice(-30).map(s => ({
    tps: Math.round((s.outputTps ?? s.tps) * 100) / 100,
    duration: Math.round((s.fullGenSeconds ?? s.duration) * 100) / 100,
  }));
  const latest = samples.at(-1) || null;
  const lastGen = [...generators].reverse().find(g => g.chatModel) || null;
  const lastChat = lastGen?.chatModel;
  return {
    source: 'Antigravity request metadata', status: response.status || null,
    conversationId: trajectory.cascadeId || null,
    steps: Number(response.numTotalSteps ?? steps.length), rounds: steps.filter(s => /USER_INPUT/.test(String(s.type))).length,
    requests: ids.size, measuredRequests: accepted.length, missingTiming, excludedTiming, rateWarnings, timingReasons, rateVersion: RATE_VERSION, counts,
    cache:{...cache,totalTokens:cache.inputTokens+cache.outputTokens,hitRate:cache.inputTokens>0?cache.cachedTokens/cache.inputTokens:null,complete:cache.missingRequests===0},
    tps: streamingSeconds > 0 ? sampledTokens / streamingSeconds : null, latestTps: latest?.status === 'ok' ? latest.tps : null,
    outputTps, latestOutputTps,
    latestRateStatus: latest?.status ?? 'missing',
    rateBasis: basisSamples.length && basisSamples.every(s => s.basis === 'response') ? 'response' : 'all-output',
    streamingSeconds, modelSeconds, toolSeconds, ttftSeconds: ttftSamples ? ttftSeconds / ttftSamples : null,
    liveTiming: { isRunning, activeModelStartedAt, activeToolStartedAt },
    liveStream,
    tpsHistory,
    latestShortSample: latest?.status === 'ok' && latest.duration < 1, model: latest?.model || null,
    context: latestContext(steps, generators, lastGen, lastChat),
    complete: Number(response.numTotalGeneratorMetadata ?? generators.length) === generators.length,
  };
}

export function quotaMetrics(response, now = Date.now()) {
  const root = response.response || response;
  const groups = root.groups?.length ? root.groups : root.buckets?.length ? [{ displayName: '账户额度', buckets: root.buckets }] : [];
  return groups.map((group, index) => ({
    id: group.buckets?.[0]?.bucketId?.replace(/-(5h|weekly)$/, '') || `group-${index}`,
    name: group.displayName || `额度组 ${index + 1}`, description: group.description || '',
    windows: Object.fromEntries(['5h', 'weekly'].map(window => {
      const bucket = (group.buckets || []).find(b => b.window === window || b.bucketId?.endsWith(`-${window}`));
      if (!bucket) return [window, { available: false, reason: '账户未返回此额度窗口' }];
      const fraction = Number(bucket.remainingFraction);
      const remaining = bucket.remainingFraction !== undefined && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 ? fraction : null;
      const date = Date.parse(bucket.resetTime);
      return [window, { available: true, id: bucket.bucketId, remaining, amount: tokenCount(bucket.remainingAmount),
        resetAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
        expired: Number.isFinite(date) && date <= now, disabled: bucket.disabled === true, description: bucket.description || '' }];
    })),
  }));
}
