import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolveModelPricing, tokenCostUsd, modelBelongsToGroup, parseGooglePricingMarkdown, PricingStore } from '../pricing.mjs';
import { QuotaEstimator, WINDOW_MS } from '../quota-estimate.mjs';

const scope = s => createHash('sha256').update(s).digest('hex');

test('pricing resolves published Gemini 4, Gemini 3.8, Claude 5.5/4.6, GPT-OSS and scheduled date changes', () => {
  const nov2026 = Date.UTC(2026, 10, 19);
  const dec2026 = Date.UTC(2026, 11, 5);
  const jan2027 = Date.UTC(2027, 0, 5);

  const neon = resolveModelPricing('Gemini 4 Neon (XHigh)', nov2026);
  assert.equal(neon.canonical, 'Gemini 4 Neon');
  assert.equal(neon.input, 3.0);
  assert.equal(neon.cacheRead, 0.15);
  assert.equal(neon.output, 15.0);
  assert.equal(neon.exact, true);

  const argonNov = resolveModelPricing('Gemini 4 Argon (Medium)', nov2026);
  const argonDec = resolveModelPricing('Orchestrator (Argon)', dec2026);
  assert.equal(argonNov.canonical, 'Gemini 4 Argon');
  assert.equal(argonNov.input, 2.0);
  assert.equal(argonNov.output, 10.0);
  assert.equal(argonDec.canonical, 'Gemini 4 Argon');
  assert.equal(argonDec.input, 4.0);
  assert.equal(argonDec.output, 20.0);

  const flashNov = resolveModelPricing('Gemini 3.8 Flash (High)', nov2026);
  const flashJan = resolveModelPricing('gemini-3.8-flash-tiered', jan2027);
  assert.equal(flashNov.input, 0.75);
  assert.equal(flashJan.input, 1.5);

  const opus55 = resolveModelPricing('Claude Opus 5.5 (High)', nov2026);
  assert.equal(opus55.canonical, 'Claude Opus 5.5');
  assert.equal(opus55.input, 4.0);
  assert.equal(opus55.cacheRead, 0.2);
  assert.equal(opus55.output, 20.0);
  assert.equal(opus55.cacheWrite, 5.0);

  const sonnet46 = resolveModelPricing('claude-sonnet-4-6', nov2026);
  assert.equal(sonnet46.input, 3.0);
  assert.equal(sonnet46.cacheRead, 0.3);

  const gptOss = resolveModelPricing('GPT-OSS 120B (Medium)', nov2026);
  assert.equal(gptOss.input, 0.15);
  assert.equal(gptOss.output, 0.6);

  assert.equal(resolveModelPricing('CompletelyUnknownModelX', nov2026), null);

  const cost = tokenCostUsd({ uncached: 1_000_000, cacheRead: 10_000_000, cacheWrite: 0, output: 100_000 }, neon);
  assert.ok(Math.abs(cost - (3.0 + 1.5 + 1.5)) < 1e-6);

  const geminiGroup = { id: 'gemini', name: 'Gemini Models' };
  const thirdParty = { id: '3p', name: 'Claude and GPT models' };
  assert.equal(modelBelongsToGroup('Orchestrator (Carbon)', geminiGroup), true);
  assert.equal(modelBelongsToGroup('Claude Opus 5.5 (High)', geminiGroup), false);
  assert.equal(modelBelongsToGroup('Claude Opus 5.5 (High)', thirdParty), true);
  assert.equal(modelBelongsToGroup('GPT-OSS 120B (Medium)', thirdParty), true);
});

test('QuotaEstimator calibrates equivalent API quota and reverse-projects remaining tokens accurately', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-quota-est-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const estimator = new QuotaEstimator(dir);
  const now = Date.UTC(2026, 10, 19, 8, 0, 0);
  const reset5h = new Date(now + 3 * 3600 * 1000).toISOString();
  const resetWeekly = new Date(now + 5 * 86400 * 1000).toISOString();
  const acct = scope('user@example.test');

  const groups = [
    {
      id: 'gemini',
      name: 'Gemini Models',
      description: 'Models within this group: Gemini 4 Neon, Gemini 4 Argon, Gemini 4 Hydrogen, Gemini 3.8 Flash',
      windows: {
        '5h': { available: true, remaining: 0.9, resetAt: reset5h, disabled: false },
        weekly: { available: true, remaining: 0.75, resetAt: resetWeekly, disabled: false },
      },
    },
  ];

  // Inside 5h window: 1M uncached ($3) + 10M cacheRead ($1.5) + 0.1M output ($1.5) = $6.00 across 10 requests
  // With 10% used (remaining = 0.9), total 5h equivalent API quota = $6.00 / 0.10 = $60.00, remaining = $54.00
  const records = Array.from({ length: 10 }, (_, i) => ({
    id: `r${i}`,
    at: now - 3600 * 1000 + i * 1000,
    model: 'Gemini 4 Neon (XHigh)',
    uncached: 100_000,
    cacheRead: 1_000_000,
    cacheWrite: 0,
    output: 10_000,
  }));
  // Older record inside weekly window but outside 5h window: $44.00 of Gemini 4 Argon
  // Total weekly cost = $6 + $44 = $50.00; with 25% used (remaining = 0.75), weekly total = $200, remaining = $150
  records.push({
    id: 'older-argon',
    at: now - 24 * 3600 * 1000,
    model: 'Gemini 4 Argon (Medium)',
    uncached: 10_000_000, // $20
    cacheRead: 140_000_000, // $14
    cacheWrite: 0,
    output: 1_000_000, // $10
  });

  const result = await estimator.estimate({ scope: acct, groups, records, activeModel: 'Gemini 4 Neon (XHigh)', now });
  const g = result.groups[0];
  assert.equal(g.id, 'gemini');
  assert.equal(g.activeModel, 'Gemini 4 Neon');

  const w5 = g.windows['5h'];
  assert.equal(w5.calibrated, true);
  assert.equal(w5.calibrationSource, 'current-window');
  assert.equal(w5.confidence, 'high');
  assert.equal(w5.usedCostUsd, 6);
  assert.equal(w5.totalQuotaUsd, 60);
  assert.equal(w5.remainingQuotaUsd, 54);
  assert.ok(w5.estimatedRemainingTokens > 0);
  // Active model Neon: 11.1M total tokens cost $6.00 => blended = $0.54054/1M => $54 / 0.54054 * 1M = 99.9M tokens
  assert.ok(Math.abs(w5.activeModelRemainingTokens - 99_900_000) < 200_000);

  const ww = g.windows.weekly;
  assert.equal(ww.calibrated, true);
  assert.equal(ww.usedCostUsd, 50);
  assert.equal(ww.totalQuotaUsd, 200);
  assert.equal(ww.remainingQuotaUsd, 150);
  assert.ok(ww.estimatedRemainingTokens > 0);

  // Per-model table includes active Neon first, plus Argon, Hydrogen, Flash
  assert.equal(g.models[0].model, 'Gemini 4 Neon');
  assert.equal(g.models[0].active, true);
  assert.ok(g.models.some(m => m.model === 'Gemini 4 Argon'));
  assert.ok(g.models.some(m => m.model === 'Gemini 4 Hydrogen'));

  // Wait for disk persistence, then simulate a fresh 5h window reset (remaining = 1.0, 0 requests in new window)
  await estimator.writeQueue;
  const freshEstimator = new QuotaEstimator(dir);
  const later = now + WINDOW_MS['5h'] + 60_000;
  const nextReset5h = new Date(later + WINDOW_MS['5h']).toISOString();
  const afterReset = await freshEstimator.estimate({
    scope: acct,
    groups: [{
      ...groups[0],
      windows: {
        '5h': { available: true, remaining: 1.0, resetAt: nextReset5h, disabled: false },
        weekly: { available: true, remaining: 0, resetAt: resetWeekly, disabled: false },
      },
    }],
    records,
    activeModel: 'Gemini 4 Neon (XHigh)',
    now: later,
  });

  const reset5hEst = afterReset.groups[0].windows['5h'];
  assert.equal(reset5hEst.calibrated, true);
  assert.equal(reset5hEst.calibrationSource, 'prior-window');
  assert.equal(reset5hEst.totalQuotaUsd, 60);
  assert.equal(reset5hEst.remainingQuotaUsd, 60);
  assert.ok(reset5hEst.estimatedRemainingTokens > 0);

  // Exhausted weekly window reports 0 remaining tokens honestly
  const exhaustedWeekly = afterReset.groups[0].windows.weekly;
  assert.equal(exhaustedWeekly.calibrated, true);
  assert.equal(exhaustedWeekly.remainingQuotaUsd, 0);
  assert.equal(exhaustedWeekly.estimatedRemainingTokens, 0);

  // Different account has no calibration leak
  const otherResult = await freshEstimator.estimate({
    scope: scope('other@example.test'),
    groups: [{
      ...groups[0],
      windows: {
        '5h': { available: true, remaining: 1.0, resetAt: nextReset5h, disabled: false },
        weekly: { available: true, remaining: 1.0, resetAt: resetWeekly, disabled: false },
      },
    }],
    records: [],
    now: later,
  });
  assert.equal(otherResult.groups[0].windows['5h'].calibrated, false);
  assert.equal(otherResult.groups[0].windows['5h'].reason, 'waiting-usage');
  await freshEstimator.writeQueue;
});

test('parseGooglePricingMarkdown and PricingStore parse live Google schedules, future models, and custom overrides', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-pricing-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sampleMd = `
## Gemini 4 Argon {% id="gemini-4-argon" %}
*[\`gemini-4-argon\`](/docs/models/gemini-4-argon)*
{% tabs %}
  {% tab title="Standard" %}
  {% table %}
  * Feature
  * Free Tier
  * Paid Tier, per 1M tokens in USD
  ---
  * Input price
  * Not available
  * $2.00 through November 30, 2026. $4.00 starting December 1, 2026.
  ---
  * Output price (including thinking tokens)
  * Not available
  * $10.00 through November 30, 2026. $20.00 starting December 1, 2026.
  ---
  * Context caching price
  * Not available
  * $0.10 through November 30, 2026. $0.20 starting December 1, 2026. Implicit caching only.
  {% /table %}
  {% /tab %}
{% /tabs %}

## Gemini 5 Xenon {% id="gemini-5-xenon" %}
*[\`gemini-5-xenon\`](/docs/models/gemini-5-xenon)*
{% tabs %}
  {% tab title="Standard" %}
  {% table %}
  * Feature
  * Free Tier
  * Paid Tier, per 1M tokens in USD
  ---
  * Input price
  * Not available
  * $6.00
  ---
  * Output price (including thinking tokens)
  * Not available
  * $30.00
  ---
  * Context caching price
  * Not available
  * $0.30
  {% /table %}
  {% /tab %}
{% /tabs %}

## Gemini 3.8 Flash TTS {% id="gemini-3.8-flash-tts" %}
*[\`gemini-3.8-flash-tts\`](/docs/models/gemini-3.8-flash-tts)*
{% table %}
  * Feature
  * Free Tier
  * Paid Tier
  ---
  * Input price
  * Free
  * $0.50 (text)
  ---
  * Output price
  * Free
  * $9.00 (audio)
{% /table %}
`;
  const parsed = parseGooglePricingMarkdown(sampleMd);
  assert.ok(parsed['Gemini 4 Argon']);
  assert.ok(parsed['Gemini 5 Xenon']);
  assert.equal(parsed['Gemini 3.8 Flash TTS'], undefined, 'TTS audio-only models should be excluded');

  let fetchCalls = 0;
  const store = new PricingStore(join(dir, 'pricing-config.json'), {
    fetchImpl: async () => { fetchCalls++; return { ok: true, status: 200, text: async () => sampleMd }; },
  });
  const live = await store.refreshLive({ force: true, now: Date.UTC(2026, 10, 20, 10, 0, 0) });
  assert.equal(live.ok, true);
  assert.equal(live.liveModelCount, 2);
  assert.equal(fetchCalls, 1);

  // Cached within TTL
  const cached = await store.refreshLive({ force: false, now: Date.UTC(2026, 10, 20, 11, 0, 0) });
  assert.equal(cached.cached, true);
  assert.equal(fetchCalls, 1);

  // Future model resolved straight from live Google pricing
  const opts = await store.options();
  const xenon = resolveModelPricing('Gemini 5 Xenon (High)', Date.UTC(2026, 10, 20), opts);
  assert.equal(xenon.canonical, 'Gemini 5 Xenon');
  assert.equal(xenon.input, 6);
  assert.equal(xenon.output, 30);
  assert.equal(xenon.cacheRead, 0.3);
  assert.equal(xenon.source, 'live-google');

  // Schedule changes at Dec 1
  assert.equal(resolveModelPricing('Gemini 4 Argon', Date.UTC(2026, 10, 20), opts).input, 2);
  assert.equal(resolveModelPricing('Gemini 4 Argon', Date.UTC(2026, 11, 2), opts).input, 4);

  // Custom override wins over live and persists across reload
  await store.setOverride('Gemini 4 Argon', { input: 4.5, cacheRead: 0.25, cacheWrite: 0, output: 22 });
  const reloaded = new PricingStore(join(dir, 'pricing-config.json'));
  const reloadedOpts = await reloaded.options();
  const overridden = resolveModelPricing('Gemini 4 Argon (Medium)', Date.UTC(2026, 10, 20), reloadedOpts);
  assert.equal(overridden.input, 4.5);
  assert.equal(overridden.output, 22);
  assert.equal(overridden.source, 'custom');
  assert.equal(overridden.hasOverride, true);
  assert.equal(overridden.defaultPricing.input, 2);

  await assert.rejects(() => reloaded.setOverride('Gemini 4 Argon', { input: -1, cacheRead: 0, output: 1 }));
  await reloaded.clearOverride('Gemini 4 Argon');
  assert.equal(resolveModelPricing('Gemini 4 Argon', Date.UTC(2026, 10, 20), await reloaded.options()).source, 'live-google');
});

test('QuotaEstimator exposes windowStartAt and computes checkpoint-based incremental delta calibration', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-quota-delta-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const estimator = new QuotaEstimator(dir);
  const acct = scope('delta@example.test');
  const resetWeekly = '2026-11-25T02:31:10.000Z';
  const expectedStart = new Date(Date.parse(resetWeekly) - WINDOW_MS.weekly).toISOString();
  const t1 = Date.parse('2026-11-19T06:00:00.000Z');
  const t2 = Date.parse('2026-11-20T06:00:00.000Z');

  // Earlier in the week: Argon consumed 20% of weekly at $20 ($100 implied weekly)
  const earlyRecords = [
    { id: 'e1', at: t1 - 3600e3, model: 'Gemini 4 Argon (Medium)', uncached: 5_000_000, cacheRead: 50_000_000, cacheWrite: 0, output: 500_000 }, // $10 + $5 + $5 = $20
  ];
  const groupBase = remaining => [{
    id: 'gemini',
    name: 'Gemini Models',
    windows: {
      '5h': { available: true, remaining: 0.9, resetAt: new Date(t2 + 3600e3).toISOString(), disabled: false },
      weekly: { available: true, remaining, resetAt: resetWeekly, disabled: false },
    },
  }];

  const first = await estimator.estimate({ scope: acct, groups: groupBase(0.8), records: earlyRecords, now: t1 });
  const w1 = first.groups[0].windows.weekly;
  assert.equal(w1.windowStartAt, expectedStart);
  assert.equal(w1.totalQuotaUsd, 100);
  assert.equal(w1.delta.available, false);

  // Next day: switched to Neon, spent $30 across 4 requests while weekly dropped from 80% -> 70% (deltaFraction = 0.10 => $300 implied delta weekly!)
  const newRecords = [
    ...earlyRecords,
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `n${i}`,
      at: t1 + (i + 1) * 3600e3,
      model: 'Gemini 4 Neon (XHigh)',
      uncached: 1_250_000, // $3.75 * 4 = $15
      cacheRead: 12_500_000, // $1.875 * 4 = $7.5
      cacheWrite: 0,
      output: 125_000, // $1.875 * 4 = $7.5 => total $30
    })),
  ];
  const second = await estimator.estimate({ scope: acct, groups: groupBase(0.7), records: newRecords, now: t2 });
  const w2 = second.groups[0].windows.weekly;
  // Full window: ($20 + $30) / 0.30 = $166.67
  assert.equal(w2.totalQuotaUsd, 166.67);
  // Delta: $30 / 0.10 = $300.00, remaining = $210.00
  assert.equal(w2.delta.available, true);
  assert.equal(w2.delta.confidence, 'high');
  assert.equal(w2.delta.deltaCostUsd, 30);
  assert.equal(w2.delta.totalQuotaUsd, 300);
  assert.equal(w2.delta.remainingQuotaUsd, 210);
  assert.equal(w2.delta.sinceAt, new Date(t1).toISOString());

  // Custom pricing override immediately re-values BOTH full-window AND delta!
  const withOverride = await estimator.estimate({
    scope: acct,
    groups: groupBase(0.7),
    records: newRecords,
    now: t2,
    pricingOptions: { overrides: { 'Gemini 4 Neon': { input: 6, cacheRead: 0.3, cacheWrite: 0, output: 30 } }, liveModels: {} },
  });
  assert.equal(withOverride.groups[0].windows.weekly.delta.deltaCostUsd, 60);
  assert.equal(withOverride.groups[0].windows.weekly.delta.totalQuotaUsd, 600);
  await estimator.writeQueue;
});

test('weekly remaining tokens uses actual weekly reset window mix instead of pre-reset rolling 7d records, and ignores jitter dips', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-quota-reset-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const estimator = new QuotaEstimator(dir);
  const acct = scope('reset-align@example.test');
  const weeklyStart = Date.parse('2026-11-21T09:00:52.000Z');
  const weeklyReset = new Date(weeklyStart + WINDOW_MS.weekly).toISOString();
  const now = Date.parse('2026-11-22T17:00:00.000Z');
  const reset5h = new Date(now + 2 * 3600e3).toISOString();

  // Heavy pre-reset usage 2 days before weeklyStart (still within rolling 7d, but BEFORE actual weekly reset!)
  const preReset = [
    { id: 'pre1', at: weeklyStart - 2 * 86400e3, model: 'Gemini 4 Neon (XHigh)', uncached: 50_000_000, cacheRead: 0, cacheWrite: 0, output: 5_000_000 }, // very expensive $4.09/1M
  ];
  // Post-reset usage inside [weeklyStart, now]: cheap high-cache Flash traffic (100M total tokens, $20 cost => $0.20/1M)
  // At 50% used (remaining = 0.50), remaining tokens MUST be ~100M (not distorted by pre-reset Neon!)
  const postReset = [
    { id: 'post1', at: weeklyStart + 3600e3, model: 'Gemini 3.8 Flash (High)', uncached: 10_000_000, cacheRead: 88_000_000, cacheWrite: 0, output: 2_000_000 },
  ];

  const groups = [{
    id: 'gemini',
    name: 'Gemini Models',
    windows: {
      '5h': { available: true, remaining: 1.0, resetAt: reset5h, disabled: false },
      weekly: { available: true, remaining: 0.5, resetAt: weeklyReset, disabled: false },
    },
  }];

  const res = await estimator.estimate({ scope: acct, groups, records: [...preReset, ...postReset], now });
  const g = res.groups[0];
  assert.equal(g.recentBasis, 'weekly-reset');
  assert.equal(g.recentSinceAt, new Date(weeklyStart).toISOString());
  assert.equal(g.recentTokens, 100_000_000);
  const ww = g.windows.weekly;
  assert.equal(ww.windowStartAt, new Date(weeklyStart).toISOString());
  assert.equal(ww.usedTokens, 100_000_000);
  // Remaining 50% at identical post-reset mix must equal usedTokens (100M) and totalTokens must equal 200M
  assert.ok(Math.abs(ww.estimatedRemainingTokens - 100_000_000) < 100_000, `Expected ~100M, got ${ww.estimatedRemainingTokens}`);
  assert.ok(Math.abs(ww.estimatedTotalTokens - 200_000_000) < 200_000, `Expected ~200M, got ${ww.estimatedTotalTokens}`);

  // When current weekly window has 0 records yet, fall back to rolling 7d
  const emptyRes = await estimator.estimate({ scope: acct, groups, records: preReset, now });
  assert.equal(emptyRes.groups[0].recentBasis, 'rolling');
  assert.equal(emptyRes.groups[0].recentWindowDays, 7);

  // Jitter dip checkpoint must not poison delta calibration
  const tA = weeklyStart + 7200e3;
  const tDip = tA + 1800e3;
  const tB = tDip + 1800e3;
  const jitterState = await estimator.load(acct);
  jitterState.checkpoints['gemini:weekly'] = {
    resetAt: weeklyReset,
    points: [
      { at: tA, usedFraction: 0.50, requests: 1 },
      { at: tDip, usedFraction: 0.48, requests: 2 }, // transient API dip
    ],
  };
  const recsWithDelta = [
    ...postReset,
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `d${i}`, at: tA + 60_000 + i * 60_000, model: 'Gemini 4 Neon (XHigh)',
      uncached: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0, // $3 each = $12 total
    })),
  ];
  const jitterRes = await estimator.estimate({
    scope: acct,
    groups: [{ ...groups[0], windows: { ...groups[0].windows, weekly: { available: true, remaining: 0.46, resetAt: weeklyReset, disabled: false } } }],
    records: recsWithDelta,
    now: tB,
  });
  // Must use tA (0.50 -> 0.54, Δ=0.04, $12 => $300) rather than dipped tDip (0.48 -> 0.54, Δ=0.06)
  assert.equal(jitterRes.groups[0].windows.weekly.delta.sinceAt, new Date(tA).toISOString());
  assert.equal(jitterRes.groups[0].windows.weekly.delta.deltaFraction, 0.04);
  await estimator.writeQueue;
});

test('usage-ui and inline-widget compile cleanly with custom period and quota estimate features', () => {
  const usageSrc = readFileSync(new URL('../../../compat/usage-ui.cjs', import.meta.url), 'utf8');
  const inlineSrc = readFileSync(new URL('../../../compat/inline-widget.cjs', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Script(usageSrc));
  assert.doesNotThrow(() => new Script(inlineSrc));
  assert.ok(usageSrc.includes('data-period="custom"'));
  assert.ok(usageSrc.includes('applyBarGeometry'));
  assert.ok(usageSrc.includes('estimate-tab'));
  assert.ok(usageSrc.includes('est-fetch-pricing'));
  assert.ok(usageSrc.includes('est-price-editor'));
  assert.ok(inlineSrc.includes('est-tok-row'));
});
