// Estimates equivalent API USD quota and remaining available tokens per quota group/window.
// Supports both full-window calibration and checkpoint-based incremental delta calibration.
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { platformPaths } from '../../compat/platform.mjs';
import {
  resolveModelPricing,
  tokenCostUsd,
  blendedCostPer1M,
  modelBelongsToGroup,
  groupReferenceModels,
} from './pricing.mjs';

const HASH = /^[a-f0-9]{64}$/;
export const WINDOW_MS = {
  '5h': 5 * 3600 * 1000,
  weekly: 7 * 86400 * 1000,
};
const RECENT_MS = 7 * 86400 * 1000;
const FALLBACK_RECENT_MS = 30 * 86400 * 1000;
const STRONG_FRACTION = 0.005;
const MIN_FRACTION = 0.001;
const BLEND_FULL_FRACTION = 0.05;
const MAX_HISTORY_ENTRIES = 6;
const MAX_CHECKPOINTS = 32;
const CHECKPOINT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_SHARES = { uncached: 0.08, cacheRead: 0.9, cacheWrite: 0, output: 0.02 };

const round = (n, digits = 4) => (typeof n === 'number' && Number.isFinite(n) ? Number(n.toFixed(digits)) : null);
const totalTokens = r => (r.uncached ?? 0) + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0) + (r.output ?? 0);

function summarizeRecords(records, now, pricingOptions) {
  let uncached = 0, cacheRead = 0, cacheWrite = 0, output = 0, total = 0, requests = 0, costUsd = 0, unpricedRequests = 0;
  const byModel = new Map();
  for (const r of records) {
    const u = r.uncached ?? 0, cr = r.cacheRead ?? 0, cw = r.cacheWrite ?? 0, o = r.output ?? 0;
    const t = u + cr + cw + o;
    if (t <= 0) continue;
    uncached += u; cacheRead += cr; cacheWrite += cw; output += o; total += t; requests++;
    const pricing = resolveModelPricing(r.model, r.at ?? now, pricingOptions);
    if (!pricing) { unpricedRequests++; continue; }
    const cost = tokenCostUsd({ uncached: u, cacheRead: cr, cacheWrite: cw, output: o }, pricing);
    costUsd += cost;
    let entry = byModel.get(pricing.canonical);
    if (!entry) {
      entry = { canonical: pricing.canonical, pricing, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0, requests: 0, costUsd: 0 };
      byModel.set(pricing.canonical, entry);
    }
    entry.uncached += u; entry.cacheRead += cr; entry.cacheWrite += cw; entry.output += o;
    entry.total += t; entry.requests++; entry.costUsd += cost;
  }
  const inputTotal = uncached + cacheRead + cacheWrite;
  const shares = total > 0 ? {
    uncached: round(uncached / total, 4),
    cacheRead: round(cacheRead / total, 4),
    cacheWrite: round(cacheWrite / total, 4),
    output: round(output / total, 4),
  } : null;
  const modelMap = {};
  for (const [canonical, e] of byModel) {
    const mInput = e.uncached + e.cacheRead + e.cacheWrite;
    const mShares = e.total > 0 ? {
      uncached: round(e.uncached / e.total, 4),
      cacheRead: round(e.cacheRead / e.total, 4),
      cacheWrite: round(e.cacheWrite / e.total, 4),
      output: round(e.output / e.total, 4),
    } : null;
    modelMap[canonical] = {
      canonical,
      pricing: resolveModelPricing(canonical, now, pricingOptions) || e.pricing,
      uncached: e.uncached, cacheRead: e.cacheRead, cacheWrite: e.cacheWrite, output: e.output,
      total: e.total, requests: e.requests, costUsd: round(e.costUsd, 4),
      cacheHitRate: mInput > 0 ? round(e.cacheRead / mInput, 4) : 0,
      shares: mShares,
      blendedCostPer1M: e.total > 0 && e.costUsd > 0 ? round((e.costUsd / e.total) * 1e6, 4) : null,
    };
  }
  return {
    uncached, cacheRead, cacheWrite, output, total, requests,
    costUsd: round(costUsd, 4),
    unpricedRequests,
    cacheHitRate: inputTotal > 0 ? round(cacheRead / inputTotal, 4) : 0,
    shares,
    blendedCostPer1M: total > 0 && costUsd > 0 ? round((costUsd / total) * 1e6, 4) : null,
    byModel: modelMap,
  };
}

function priorWeightedQuota(samples, currentResetAt) {
  const usable = (samples || [])
    .filter(s => s && s.resetAt !== currentResetAt && typeof s.totalQuotaUsd === 'number'
      && Number.isFinite(s.totalQuotaUsd) && s.totalQuotaUsd > 0
      && typeof s.usedFraction === 'number' && s.usedFraction >= STRONG_FRACTION)
    .sort((a, b) => Date.parse(b.resetAt || 0) - Date.parse(a.resetAt || 0));
  if (!usable.length) return null;
  let weightedSum = 0, totalWeight = 0;
  usable.forEach((s, index) => {
    const confidenceWeight = Math.max(0.15, Math.min(1, s.usedFraction * 4));
    const recencyWeight = Math.pow(0.75, index);
    const weight = confidenceWeight * recencyWeight;
    weightedSum += s.totalQuotaUsd * weight;
    totalWeight += weight;
  });
  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

function computeBreakdown(tokens, shares) {
  if (tokens === null) return null;
  if (tokens === 0) return { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  if (!shares) return null;
  return {
    uncached: Math.round(tokens * shares.uncached),
    cacheRead: Math.round(tokens * shares.cacheRead),
    cacheWrite: Math.round(tokens * shares.cacheWrite),
    output: Math.round(tokens * shares.output),
  };
}

function computeDeltaCalibration({ points, windowRecords, usedFraction, remaining, now, endMs, pricingOptions, projectionMix }) {
  if (!Array.isArray(points) || !points.length) return { available: false, reason: 'collecting' };
  // Filter out transient API dip checkpoints (where reported usedFraction temporarily
  // dropped below an earlier checkpoint in the same window) so server jitter cannot
  // artificially inflate deltaFraction.
  const monotonic = [];
  let maxFrac = -1;
  for (const cp of points) {
    if (!cp || !Number.isSafeInteger(cp.at) || cp.at >= endMs) continue;
    if (typeof cp.usedFraction !== 'number' || !Number.isFinite(cp.usedFraction)) continue;
    if (cp.usedFraction + 1e-6 < maxFrac) continue;
    maxFrac = Math.max(maxFrac, cp.usedFraction);
    monotonic.push(cp);
  }
  const tiers = [
    { minFrac: 0.03, minReqs: 3, confidence: 'high' },
    { minFrac: 0.015, minReqs: 2, confidence: 'medium' },
    { minFrac: 0.01, minReqs: 1, confidence: 'low' },
  ];
  for (const tier of tiers) {
    for (let i = monotonic.length - 1; i >= 0; i--) {
      const cp = monotonic[i];
      const deltaFraction = usedFraction - cp.usedFraction;
      if (deltaFraction < tier.minFrac) continue;
      const slice = windowRecords.filter(r => r.at > cp.at && r.at <= endMs);
      if (slice.length < tier.minReqs) continue;
      const summary = summarizeRecords(slice, now, pricingOptions);
      if (summary.costUsd <= 0) continue;
      const totalQuotaUsd = summary.costUsd / deltaFraction;
      const remainingQuotaUsd = remaining === 0 ? 0 : Math.max(0, totalQuotaUsd * remaining);
      const mix = summary.blendedCostPer1M > 0 ? summary : projectionMix;
      const estimatedRemainingTokens = remaining === 0
        ? 0
        : (mix?.blendedCostPer1M > 0 ? Math.round((remainingQuotaUsd / mix.blendedCostPer1M) * 1e6) : null);
      const estimatedTotalTokens = mix?.blendedCostPer1M > 0
        ? Math.round((totalQuotaUsd / mix.blendedCostPer1M) * 1e6)
        : null;
      return {
        available: true,
        confidence: tier.confidence,
        sinceAt: new Date(cp.at).toISOString(),
        deltaFraction: round(deltaFraction, 6),
        deltaCostUsd: summary.costUsd,
        deltaTokens: summary.total,
        deltaRequests: summary.requests,
        totalQuotaUsd: round(totalQuotaUsd, 2),
        remainingQuotaUsd: round(remainingQuotaUsd, 2),
        blendedCostPer1M: mix?.blendedCostPer1M ?? null,
        cacheHitRate: mix?.total > 0 ? mix.cacheHitRate : null,
        shares: mix?.shares ?? null,
        estimatedRemainingTokens,
        estimatedTotalTokens,
        breakdown: computeBreakdown(estimatedRemainingTokens, mix?.shares),
      };
    }
  }
  return { available: false, reason: 'collecting' };
}

export class QuotaEstimator {
  constructor(directory = join(platformPaths().data, 'quota-calibration-v1')) {
    this.directory = directory;
    this.cache = new Map();
    this.writeQueue = Promise.resolve();
    this.estimateCache = null;
  }

  file(scope) {
    if (!HASH.test(scope)) throw new Error('Invalid calibration scope');
    return join(this.directory, `${scope}.json`);
  }

  async load(scope) {
    if (!scope || !HASH.test(scope)) return { schema: 1, account: scope || '', windows: {}, checkpoints: {} };
    if (this.cache.has(scope)) return this.cache.get(scope);
    try {
      const raw = JSON.parse(await readFile(this.file(scope), 'utf8'));
      if (raw?.schema === 1 && raw.account === scope && raw.windows && typeof raw.windows === 'object') {
        if (!raw.checkpoints || typeof raw.checkpoints !== 'object') raw.checkpoints = {};
        this.cache.set(scope, raw);
        return raw;
      }
    } catch {}
    const empty = { schema: 1, account: scope, windows: {}, checkpoints: {} };
    this.cache.set(scope, empty);
    return empty;
  }

  persist(scope, state) {
    if (!scope || !HASH.test(scope)) return;
    const payload = JSON.stringify(state);
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const file = this.file(scope);
      await mkdir(this.directory, { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, payload, { mode: 0o600 });
        await rename(temp, file);
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error;
      }
    }).catch(() => {});
  }

  recordSample(state, key, sample) {
    if (!sample.resetAt || !Number.isFinite(sample.totalQuotaUsd) || sample.totalQuotaUsd <= 0) return false;
    const list = Array.isArray(state.windows[key]) ? [...state.windows[key]] : [];
    const existingIndex = list.findIndex(item => item.resetAt === sample.resetAt);
    if (existingIndex >= 0) {
      const prev = list[existingIndex];
      const fracDelta = Math.abs((sample.usedFraction || 0) - (prev.usedFraction || 0));
      const reqDelta = Math.abs((sample.requests || 0) - (prev.requests || 0));
      if (fracDelta < 0.002 && reqDelta < 2) return false;
      list[existingIndex] = sample;
    } else {
      list.push(sample);
    }
    list.sort((a, b) => Date.parse(b.resetAt || 0) - Date.parse(a.resetAt || 0));
    state.windows[key] = list.slice(0, MAX_HISTORY_ENTRIES);
    return true;
  }

  recordCheckpoint(state, key, resetAt, at, usedFraction, requests) {
    if (!resetAt || !Number.isSafeInteger(at)) return false;
    state.checkpoints ||= {};
    let bucket = state.checkpoints[key];
    if (!bucket || bucket.resetAt !== resetAt || !Array.isArray(bucket.points)) {
      bucket = { resetAt, points: [] };
      state.checkpoints[key] = bucket;
    }
    const last = bucket.points.at(-1);
    const shouldAdd = !last
      || usedFraction - last.usedFraction >= 0.005
      || (usedFraction >= last.usedFraction && at - last.at >= CHECKPOINT_INTERVAL_MS && requests > (last.requests || 0));
    if (!shouldAdd) return false;
    bucket.points.push({ at, usedFraction: round(usedFraction, 6), requests });
    if (bucket.points.length > MAX_CHECKPOINTS) {
      // Keep earliest baseline + most recent checkpoints
      bucket.points = [bucket.points[0], ...bucket.points.slice(-(MAX_CHECKPOINTS - 1))];
    }
    return true;
  }

  async estimate({ scope = null, groups = [], records = [], activeModel = null, now = Date.now(), pricingOptions = null, pricingMeta = null } = {}) {
    if (!Array.isArray(groups) || !groups.length) return { groups: [], pricingMeta };
    const groupsKey = JSON.stringify(groups.map(g => [
      g?.id || '',
      g?.windows?.['5h']?.remaining ?? null,
      g?.windows?.['5h']?.resetAt || '',
      g?.windows?.['5h']?.disabled === true,
      g?.windows?.weekly?.remaining ?? null,
      g?.windows?.weekly?.resetAt || '',
      g?.windows?.weekly?.disabled === true,
    ]));
    const pricingKey = JSON.stringify([pricingMeta?.liveFetchedAt || '', pricingOptions?.overrides || null, pricingOptions?.liveModels ? Object.keys(pricingOptions.liveModels).length : 0]);
    const recLen = Array.isArray(records) ? records.length : 0;
    const lastRec = recLen ? records[recLen - 1] : null;
    const lastRecKey = lastRec ? `${lastRec.id || ''}:${lastRec.at || ''}` : '';
    const cached = this.estimateCache;
    if (cached
      && cached.scope === scope
      && cached.recordsRef === records
      && cached.recLen === recLen
      && cached.lastRecKey === lastRecKey
      && cached.activeModel === activeModel
      && cached.groupsKey === groupsKey
      && cached.pricingKey === pricingKey
      && (now === cached.now || (now >= cached.now && now - cached.now < 15000))) {
      return cached.result;
    }
    const state = scope && HASH.test(scope) ? await this.load(scope) : { schema: 1, account: '', windows: {}, checkpoints: {} };
    const datedRecords = (records || []).filter(r => r && Number.isSafeInteger(r.at) && totalTokens(r) > 0);
    const activePricing = resolveModelPricing(activeModel, now, pricingOptions);
    let dirty = false;

    const estimatedGroups = groups.map(group => {
      const groupRecords = datedRecords.filter(r => modelBelongsToGroup(r.model, group, pricingOptions));
      const weeklyBucket = group.windows?.weekly;
      const weeklyResetMs = weeklyBucket?.available && !weeklyBucket.disabled && weeklyBucket.resetAt
        ? Date.parse(weeklyBucket.resetAt)
        : NaN;
      const weeklyStartMs = Number.isFinite(weeklyResetMs) ? weeklyResetMs - WINDOW_MS.weekly : NaN;
      const weeklyEndMs = Number.isFinite(weeklyResetMs) ? Math.min(now, weeklyResetMs) : now;
      const weeklyWindowRecords = Number.isFinite(weeklyStartMs)
        ? groupRecords.filter(r => r.at >= weeklyStartMs && r.at <= weeklyEndMs)
        : [];
      const recent7d = groupRecords.filter(r => r.at >= now - RECENT_MS && r.at <= now);
      const recent30d = recent7d.length ? recent7d : groupRecords.filter(r => r.at >= now - FALLBACK_RECENT_MS && r.at <= now);
      const usingWeeklyReset = weeklyWindowRecords.length > 0;
      const recentBase = usingWeeklyReset ? weeklyWindowRecords : (recent30d.length ? recent30d : groupRecords);
      const recentWindowDays = usingWeeklyReset ? null : (recent7d.length ? 7 : recent30d.length ? 30 : null);
      const recentSinceAt = usingWeeklyReset ? new Date(weeklyStartMs).toISOString() : null;
      const recentBasis = usingWeeklyReset ? 'weekly-reset' : 'rolling';
      const recentMix = summarizeRecords(recentBase, now, pricingOptions);

      const windows = {};
      for (const windowName of ['5h', 'weekly']) {
        const bucket = group.windows?.[windowName];
        if (!bucket?.available || bucket.disabled || typeof bucket.remaining !== 'number' || !Number.isFinite(bucket.remaining)) {
          windows[windowName] = { available: false, calibrated: false, reason: 'window-unavailable' };
          continue;
        }
        const remaining = Math.max(0, Math.min(1, bucket.remaining));
        const usedFraction = Math.max(0, 1 - remaining);
        const duration = WINDOW_MS[windowName];
        const resetMs = bucket.resetAt ? Date.parse(bucket.resetAt) : NaN;
        const startMs = Number.isFinite(resetMs) ? resetMs - duration : now - duration;
        const endMs = Number.isFinite(resetMs) ? Math.min(now, resetMs) : now;
        const windowStartAt = Number.isFinite(startMs) ? new Date(startMs).toISOString() : null;
        const windowRecords = groupRecords.filter(r => r.at >= startMs && r.at <= endMs);
        const winSummary = summarizeRecords(windowRecords, now, pricingOptions);

        const key = `${group.id}:${windowName}`;
        if (bucket.resetAt && (usedFraction > 0 || winSummary.requests > 0)) {
          if (this.recordCheckpoint(state, key, bucket.resetAt, now, usedFraction, winSummary.requests)) dirty = true;
        }

        const directTotalUsd = usedFraction >= MIN_FRACTION && winSummary.costUsd > 0 && winSummary.requests > 0
          ? winSummary.costUsd / usedFraction
          : null;
        const priorTotalUsd = priorWeightedQuota(state.windows[key], bucket.resetAt || null);

        if (usedFraction >= STRONG_FRACTION && directTotalUsd !== null && bucket.resetAt) {
          const changed = this.recordSample(state, key, {
            resetAt: bucket.resetAt,
            totalQuotaUsd: round(directTotalUsd, 4),
            usedCostUsd: winSummary.costUsd,
            usedFraction: round(usedFraction, 6),
            requests: winSummary.requests,
          });
          if (changed) dirty = true;
        }

        let totalQuotaUsd = null;
        let calibrationSource = null;
        let confidence = null;
        let reason = null;

        if (remaining === 0) {
          totalQuotaUsd = directTotalUsd ?? priorTotalUsd ?? (winSummary.costUsd > 0 ? winSummary.costUsd : null);
          calibrationSource = directTotalUsd !== null ? 'current-window' : priorTotalUsd !== null ? 'prior-window' : 'exhausted';
          confidence = directTotalUsd !== null ? 'high' : 'medium';
        } else if (usedFraction >= STRONG_FRACTION && directTotalUsd !== null) {
          if (priorTotalUsd !== null && usedFraction < BLEND_FULL_FRACTION) {
            const alpha = usedFraction / BLEND_FULL_FRACTION;
            totalQuotaUsd = alpha * directTotalUsd + (1 - alpha) * priorTotalUsd;
            calibrationSource = 'blended';
            confidence = 'medium';
          } else {
            totalQuotaUsd = directTotalUsd;
            calibrationSource = 'current-window';
            confidence = usedFraction >= BLEND_FULL_FRACTION && winSummary.requests >= 10 ? 'high' : 'medium';
          }
        } else if (priorTotalUsd !== null) {
          totalQuotaUsd = priorTotalUsd;
          calibrationSource = 'prior-window';
          confidence = 'medium';
        } else if (directTotalUsd !== null) {
          totalQuotaUsd = directTotalUsd;
          calibrationSource = 'current-window';
          confidence = 'low';
        } else {
          reason = usedFraction < MIN_FRACTION ? 'waiting-usage' : 'missing-local-usage';
        }

        const calibrated = remaining === 0 || (totalQuotaUsd !== null && totalQuotaUsd > 0);
        const remainingQuotaUsd = remaining === 0 ? 0 : calibrated ? Math.max(0, totalQuotaUsd * remaining) : null;

        const projectionMix = winSummary.total > 0 && winSummary.blendedCostPer1M > 0
          ? winSummary
          : recentMix.total > 0 && recentMix.blendedCostPer1M > 0
            ? recentMix
            : null;

        const estimatedRemainingTokens = remaining === 0
          ? 0
          : (remainingQuotaUsd !== null && projectionMix?.blendedCostPer1M > 0
            ? Math.round((remainingQuotaUsd / projectionMix.blendedCostPer1M) * 1e6)
            : null);
        const estimatedTotalTokens = totalQuotaUsd !== null && projectionMix?.blendedCostPer1M > 0
          ? Math.round((totalQuotaUsd / projectionMix.blendedCostPer1M) * 1e6)
          : null;
        const breakdown = computeBreakdown(estimatedRemainingTokens, projectionMix?.shares);

        let activeModelRemainingTokens = null;
        if (activePricing && modelBelongsToGroup(activeModel, group, pricingOptions) && remainingQuotaUsd !== null) {
          if (remaining === 0) {
            activeModelRemainingTokens = 0;
          } else {
            const mEntry = recentMix.byModel[activePricing.canonical];
            const shares = (mEntry && mEntry.requests >= 5 && mEntry.shares)
              || projectionMix?.shares
              || DEFAULT_SHARES;
            const costPer1M = blendedCostPer1M(activePricing, shares);
            if (costPer1M) activeModelRemainingTokens = Math.round((remainingQuotaUsd / costPer1M) * 1e6);
          }
        }

        const cpBucket = state.checkpoints?.[key];
        const delta = cpBucket?.resetAt === bucket.resetAt
          ? computeDeltaCalibration({
            points: cpBucket.points,
            windowRecords,
            usedFraction,
            remaining,
            now,
            endMs,
            pricingOptions,
            projectionMix,
          })
          : { available: false, reason: 'collecting' };

        windows[windowName] = {
          available: true,
          calibrated,
          calibrationSource,
          confidence,
          reason,
          remaining: round(remaining, 6),
          usedFraction: round(usedFraction, 6),
          windowStartAt,
          resetAt: bucket.resetAt || null,
          usedCostUsd: winSummary.costUsd,
          usedTokens: winSummary.total,
          windowRequests: winSummary.requests,
          unpricedRequests: winSummary.unpricedRequests,
          totalQuotaUsd: totalQuotaUsd !== null ? round(totalQuotaUsd, 2) : null,
          remainingQuotaUsd: remainingQuotaUsd !== null ? round(remainingQuotaUsd, 2) : null,
          blendedCostPer1M: projectionMix?.blendedCostPer1M ?? null,
          cacheHitRate: projectionMix?.total > 0 ? projectionMix.cacheHitRate : null,
          shares: projectionMix?.shares ?? null,
          estimatedRemainingTokens,
          estimatedTotalTokens,
          activeModelRemainingTokens,
          breakdown,
          delta,
        };
      }

      // Build per-model reverse-projection list
      const refModels = groupReferenceModels(group, now, pricingOptions);
      const modelCandidates = new Map();
      for (const [canonical, entry] of Object.entries(recentMix.byModel)) {
        modelCandidates.set(canonical, { pricing: entry.pricing, recent: entry });
      }
      for (const ref of refModels) {
        if (!modelCandidates.has(ref.canonical)) {
          modelCandidates.set(ref.canonical, { pricing: ref, recent: null });
        }
      }
      if (activePricing && modelBelongsToGroup(activeModel, group, pricingOptions) && !modelCandidates.has(activePricing.canonical)) {
        modelCandidates.set(activePricing.canonical, { pricing: activePricing, recent: null });
      }

      const defaultShares = recentMix.shares || DEFAULT_SHARES;
      const defaultCacheHit = recentMix.total > 0 ? recentMix.cacheHitRate : 0.9;
      const rem5hUsd = windows['5h']?.calibrated ? windows['5h'].remainingQuotaUsd : null;
      const remWeeklyUsd = windows.weekly?.calibrated ? windows.weekly.remainingQuotaUsd : null;

      const models = [...modelCandidates.entries()].map(([canonical, { pricing, recent }]) => {
        const shares = (recent && recent.requests >= 5 && recent.shares) ? recent.shares : defaultShares;
        const ratePer1M = blendedCostPer1M(pricing, shares);
        return {
          model: canonical,
          active: activePricing?.canonical === canonical,
          pricing: {
            input: pricing.input,
            output: pricing.output,
            cacheRead: pricing.cacheRead,
            cacheWrite: pricing.cacheWrite,
            exact: pricing.exact,
            source: pricing.source || 'builtin',
            hasOverride: Boolean(pricing.hasOverride),
            defaultPricing: pricing.defaultPricing || null,
          },
          recentTokens: recent?.total ?? 0,
          recentRequests: recent?.requests ?? 0,
          recentCostUsd: recent?.costUsd ?? 0,
          cacheHitRate: recent && recent.requests >= 5 ? recent.cacheHitRate : defaultCacheHit,
          shares,
          blendedCostPer1M: ratePer1M !== null ? round(ratePer1M, 4) : null,
          remaining5hTokens: rem5hUsd !== null && ratePer1M ? Math.round((rem5hUsd / ratePer1M) * 1e6) : null,
          remainingWeeklyTokens: remWeeklyUsd !== null && ratePer1M ? Math.round((remWeeklyUsd / ratePer1M) * 1e6) : null,
        };
      }).sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (b.recentTokens !== a.recentTokens) return b.recentTokens - a.recentTokens;
        return b.pricing.input - a.pricing.input;
      });

      return {
        id: group.id,
        name: group.name,
        activeModel: activePricing && modelBelongsToGroup(activeModel, group, pricingOptions) ? activePricing.canonical : null,
        recentBasis,
        recentSinceAt,
        recentWindowDays,
        recentRequests: recentMix.requests,
        recentTokens: recentMix.total,
        recentCostUsd: recentMix.costUsd,
        recentCacheHitRate: recentMix.total > 0 ? recentMix.cacheHitRate : null,
        recentShares: recentMix.shares || DEFAULT_SHARES,
        recentBlendedCostPer1M: recentMix.blendedCostPer1M,
        windows,
        models,
      };
    });

    if (dirty && scope && HASH.test(scope)) this.persist(scope, state);
    const result = { groups: estimatedGroups, pricingMeta };
    this.estimateCache = { scope, recordsRef: records, recLen, lastRecKey, activeModel, groupsKey, pricingKey, now, result };
    return result;
  }
}
