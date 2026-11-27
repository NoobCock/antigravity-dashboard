import { percent, rate, count, elapsed, countdown, resetDate } from './format.mjs';
import { createI18n } from './i18n.js';
import { createTheme } from './theme.js';
function initPanel(){
if(!document.querySelector('.widget')||window.__agPulsePanelInstalled)return;
window.__agPulsePanelInstalled=true;
const theme=createTheme();
let themeController=theme.attach(document.documentElement);
window.addEventListener('pagehide',()=>themeController.dispose());
window.addEventListener('pageshow',event=>{if(event.persisted)themeController=theme.attach(document.documentElement);});
const localGet=key=>{try{return localStorage.getItem(key);}catch{return null;}};
const localSet=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
const language=createI18n(localGet('ag-pulse-language'));
const t=language.t;

const $ = id => document.getElementById(id);
const compact=n=>typeof n!=='number'||!Number.isFinite(n)?'—':n>=1e9?`${(n/1e9).toFixed(1).replace(/\.0$/,'')}B`:n>=1e6?`${(n/1e6).toFixed(1).replace(/\.0$/,'')}M`:n>=1e3?`${(n/1e3).toFixed(1).replace(/\.0$/,'')}K`:String(n);
const fmtUsd=n=>typeof n!=='number'||!Number.isFinite(n)?'—':n>=100?'$'+n.toFixed(1):n>=1?'$'+n.toFixed(2):'$'+n.toFixed(3);
const chips = [...document.querySelectorAll('[data-card]')];
let snapshot = null, selectedGroup = localGet('ag-pulse-group'), group = null;
let pending = false, timer = null, serverOffset = 0, lastExpiredRefresh = 0;
let selectedCard='speed',cardMotion=null;
let refreshRequest=null,manualRequest=null;
let usageDashboard=null,usageGuideDismissed=false;
const SAMPLE_OPTIONS=[500,1000,2000,5000];
let sampleIntervalMs=SAMPLE_OPTIONS.includes(Number(localGet('ag-pulse-tps-interval')))?Number(localGet('ag-pulse-tps-interval')):1000;
let tpsSeries=[],tpsSeriesConvo=null,tpsChartHoverIdx=null,sampleTimer=null;
let streamState={stepIdx:-1,prevBytes:0,prevAt:0,liveTps:null,lastCompletedReqs:-1};
const CTX_COLORS={chat:'#3b82f6',tools:'#f59e0b',system:'#8b5cf6',subagents:'#10b981',skills:'#ec4899',plugins:'#06b6d4',mcp:'#f97316',other:'#94a3b8'};
const CTX_LABELS={chat:'ctxChat',tools:'ctxTools',system:'ctxSystem',subagents:'ctxSubagents',skills:'ctxSkills',plugins:'ctxPlugins',mcp:'ctxMcp',other:'ctxOther'};
const host = window.sidecar;
if (!host) document.body.classList.add('standalone');
const preferenceRequest=async(input)=>{
  const transport=host?.fetch?host.fetch.bind(host):fetch;
  const response=await transport('/api/preferences',input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{cache:'no-store'});
  if(!response.ok)throw new Error('Preferences unavailable');return response.json();
};
const connectPreferences=()=>language.connectPreferences({read:()=>preferenceRequest(),write:preferenceRequest,
  cache:value=>localSet('ag-pulse-language',value),changed:()=>{localize();render();updateCountdowns();}});
let preferences=connectPreferences();

function showCard(name,animate=false) {
  if(!['speed','cache','context'].includes(name))return;
  const changed=selectedCard!==name;selectedCard=name;
  cardMotion?.cancel();cardMotion=null;
  for (const chip of chips){const selected=chip.dataset.card===name;chip.setAttribute('aria-selected',String(selected));chip.tabIndex=selected?0:-1;}
  for (const nameKey of ['speed','cache','context']) $(`${nameKey}-card`).hidden = name !== nameKey;
  if(changed&&animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches)cardMotion=$(`${name}-card`).animate([{opacity:.5,transform:'translateY(5px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:200,easing:'cubic-bezier(.16,1,.3,1)'});
}
for (const chip of chips) {
  chip.addEventListener('click', event => showCard(chip.dataset.card,event.detail>0));
  chip.addEventListener('keydown',event=>{
    const current=chips.indexOf(chip);let next;
    if(event.key==='ArrowRight')next=(current+1)%chips.length;else if(event.key==='ArrowLeft')next=(current+chips.length-1)%chips.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=chips.length-1;else return;
    event.preventDefault();showCard(chips[next].dataset.card);chips[next].focus();
  });
}
function localize(){
  document.documentElement.lang=language.language;
  for(const e of document.querySelectorAll('[data-i18n]'))e.textContent=t(e.dataset.i18n);
  for(const e of document.querySelectorAll('[data-i18n-aria]'))e.setAttribute('aria-label',t(e.dataset.i18nAria));
  for(const e of document.querySelectorAll('[data-i18n-aria][title]'))e.title=t(e.dataset.i18nAria);
  $('language-toggle').textContent=language.language==='en'?'EN':'中';$('language-toggle').title=t('switchLanguage')+(preferences.error?' ('+t('languageSaveFailed')+')':'');$('language-toggle').dataset.saveFailed=String(preferences.error);
  const zh=language.language==='zh-CN';
  if($('usage-today-label')){$('usage-today-label').textContent=zh?'今日用量':'Today';$('usage-month-label').textContent=zh?'本月用量':'This month';$('usage-open-label').textContent=zh?'查看用量统计':'View token usage';}
  if($('est-open-label'))$('est-open-label').textContent=t('estOpen');
}

function chooseGroup(groups, speed) {
  if (selectedGroup && groups.some(g => g.id === selectedGroup)) return groups.find(g => g.id === selectedGroup);
  const model = String(speed?.model || '').toLowerCase();
  return groups.find(g => /gemini/.test(model) ? /gemini/i.test(g.id) : /claude|gpt/.test(model) ? /3p|claude|gpt/i.test(g.id) : false) || groups[0] || null;
}
function groupLabel(value) {
  return /gemini/i.test(value.name) ? 'Gemini' : /claude|gpt/i.test(value.name) ? 'Claude / GPT' : value.name;
}

function renderQuota(window, prefix) {
  const bucket = group?.windows?.[window];
  const remaining = bucket?.remaining;
  $(`${prefix}-balance`).textContent = percent(remaining);
  const fill = $(`${prefix}-fill`), track = $(`${prefix}-track`);
  fill.style.width = typeof remaining === 'number' ? `${remaining * 100}%` : '0%';
  fill.style.background = remaining !== null && remaining < .05 ? 'var(--pulse-danger)' : remaining !== null && remaining < .2 ? 'var(--pulse-warning)' : '';
  if (typeof remaining === 'number') { track.setAttribute('aria-valuenow', String(remaining * 100)); track.setAttribute('aria-valuemin','0'); track.setAttribute('aria-valuemax','100'); }
  else track.removeAttribute('aria-valuenow');
  $(`${prefix}-reset`).textContent = language.resetDate(bucket?.resetAt);
  const estGroup = (snapshot?.quotaEstimate?.groups || []).find(g => g.id === group?.id);
  const estW = estGroup?.windows?.[window];
  const usdRow = $(`${prefix}-est-usd-row`), tokRow = $(`${prefix}-est-tok-row`);
  if (usdRow && tokRow) {
    if (estW?.available && estW.calibrated) {
      usdRow.hidden = estW.totalQuotaUsd == null;
      if (estW.totalQuotaUsd != null) $(`${prefix}-est-usd`).textContent = `~${fmtUsd(estW.remainingQuotaUsd)} / ~${fmtUsd(estW.totalQuotaUsd)}`;
      tokRow.hidden = false;
      const tok = estW.estimatedRemainingTokens, totTok = estW.estimatedTotalTokens;
      const tokEl = $(`${prefix}-est-tok`);
      tokEl.textContent = tok == null ? '—' : tok === 0 ? (totTok != null ? `0 / ~${compact(totTok)}` : '0 tok') : (totTok != null ? `~${compact(tok)} / ~${compact(totTok)}` : `~${compact(tok)} tok`);
      tokEl.title = tok != null ? `${count(tok)}${totTok != null ? ' / ' + count(totTok) : ''} tok${estW.calibrationSource === 'prior-window' ? ' (' + t('estPrior') + ')' : ''}` : '';
    } else if (estW?.available) {
      usdRow.hidden = true;
      tokRow.hidden = false;
      $(`${prefix}-est-tok`).textContent = t('estWaiting');
    } else {
      usdRow.hidden = true;
      tokRow.hidden = true;
    }
  }
  $(`${prefix}-note`).textContent = !bucket?.available ? t('noQuota') : bucket.disabled ? t('disabledQuota') : remaining === null ? t('noFraction') : '';
}

function updateLiveTiming() {
  const speed = snapshot?.speed, lt = speed?.liveTiming, running = Boolean(lt?.isRunning);
  const calc = (base, startedAt) => {
    const startMs = startedAt ? Date.parse(startedAt) : NaN;
    const active = Number.isFinite(startMs);
    const extra = active ? Math.max(0, (Date.now() + serverOffset - startMs) / 1000) : 0;
    const total = typeof base === 'number' && Number.isFinite(base) ? base + extra : (active ? extra : null);
    return { total, active };
  };
  const m = calc(speed?.modelSeconds, running ? lt?.activeModelStartedAt : null);
  const tl = calc(speed?.toolSeconds, running ? lt?.activeToolStartedAt : null);
  $('model-time').textContent = language.elapsed(m.total);
  $('tool-time').textContent = language.elapsed(tl.total);
  $('model-time-cell')?.classList.toggle('live-active', m.active);
  $('tool-time-cell')?.classList.toggle('live-active', tl.active);
}
const effectiveAvgTps = speed => typeof speed?.outputTps === 'number' && Number.isFinite(speed.outputTps) ? speed.outputTps : (typeof speed?.tps === 'number' && Number.isFinite(speed.tps) ? speed.tps : null);
const effectiveLatestTps = speed => typeof speed?.latestOutputTps === 'number' && Number.isFinite(speed.latestOutputTps) ? speed.latestOutputTps : (typeof speed?.latestTps === 'number' && Number.isFinite(speed.latestTps) ? speed.latestTps : null);
const isModelGenerating = speed => Boolean(speed?.liveTiming?.isRunning && speed?.liveTiming?.activeModelStartedAt && !speed?.liveTiming?.activeToolStartedAt);

function seedTpsSeries(speed) {
  if (!speed) return;
  const cid = speed.conversationId || '';
  if (tpsSeriesConvo !== cid) {
    tpsSeriesConvo = cid;
    streamState = { stepIdx: -1, prevBytes: 0, prevAt: 0, liveTps: null, lastCompletedReqs: typeof speed.requests === 'number' ? speed.requests : 0 };
    const hist = (speed.tpsHistory || []).map(p => p?.tps).filter(n => typeof n === 'number' && Number.isFinite(n) && n > 0);
    if (hist.length) tpsSeries = hist.slice(-24);
    else {
      const init = effectiveLatestTps(speed) ?? effectiveAvgTps(speed);
      tpsSeries = init !== null ? [init] : [];
    }
  } else if (!tpsSeries.length) {
    const init = effectiveLatestTps(speed) ?? effectiveAvgTps(speed);
    if (init !== null) tpsSeries = [init];
  }
}
function syncCompletedTpsSample(speed) {
  if (!speed) return;
  seedTpsSeries(speed);
  const reqs = typeof speed.requests === 'number' ? speed.requests : 0;
  if (streamState.lastCompletedReqs < 0) { streamState.lastCompletedReqs = reqs; return; }
  if (reqs > streamState.lastCompletedReqs) {
    streamState.lastCompletedReqs = reqs;
    streamState.liveTps = null;
    streamState.stepIdx = -1;
    const val = effectiveLatestTps(speed);
    if (val !== null) { tpsSeries.push(Math.round(val * 10) / 10); if (tpsSeries.length > 40) tpsSeries.shift(); }
  }
}
function sampleLiveStreamingTps() {
  const speed = snapshot?.speed;
  if (!speed || !isModelGenerating(speed)) {
    streamState.liveTps = null;
    streamState.stepIdx = -1;
    return;
  }
  const now = Date.now(), ls = speed.liveStream;
  const stepIdx = ls?.stepIndex ?? (speed.steps || 0);
  const bytes = typeof ls?.bytes === 'number' ? ls.bytes : 0;
  if (streamState.stepIdx !== stepIdx) {
    streamState.stepIdx = stepIdx; streamState.prevBytes = bytes; streamState.prevAt = now;
    const startMs = ls?.startedAt ? Date.parse(ls.startedAt) : NaN;
    if (bytes > 0 && Number.isFinite(startMs) && now + serverOffset - startMs >= 250) {
      streamState.liveTps = (bytes / 3.7) / ((now + serverOffset - startMs) / 1000);
      tpsSeries.push(Math.round(streamState.liveTps * 10) / 10); if (tpsSeries.length > 40) tpsSeries.shift();
    }
    return;
  }
  const dt = (now - streamState.prevAt) / 1000;
  if (dt < 0.2) return;
  const dBytes = Math.max(0, bytes - streamState.prevBytes);
  streamState.prevBytes = bytes; streamState.prevAt = now;
  if (dBytes > 0) {
    const inst = (dBytes / 3.7) / dt;
    streamState.liveTps = streamState.liveTps !== null ? streamState.liveTps * 0.35 + inst * 0.65 : inst;
    tpsSeries.push(Math.round(streamState.liveTps * 10) / 10); if (tpsSeries.length > 40) tpsSeries.shift();
  }
}
function renderTpsChart() {
  const svgEl = $('tps-chart-svg'), emptyEl = $('tps-chart-empty');
  if (!svgEl || !emptyEl) return;
  const speed = snapshot?.speed;
  const avg = effectiveAvgTps(speed);
  const pts = tpsSeries;
  if (!pts.length) {
    emptyEl.hidden = false;
    svgEl.innerHTML = '';
    $('tps-chart-peak').textContent = '—';
    $('tps-chart-avg-label').textContent = avg !== null ? `${t('tpsAvg')} ${rate(avg)}` : '—';
    $('tps-chart-hover').textContent = '';
    return;
  }
  emptyEl.hidden = true;
  const W = 288, H = 84, padT = 8, padB = 8, padL = 2, padR = 4;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const allVals = avg !== null ? [...pts, avg] : pts;
  const maxV = Math.max(10, Math.ceil(Math.max(...allVals, 1) * 1.18 / 5) * 5);
  const xAt = i => pts.length === 1 ? padL + plotW : padL + (i / (pts.length - 1)) * plotW;
  const yAt = v => padT + plotH - (Math.max(0, Math.min(maxV, v)) / maxV) * plotH;
  const coords = pts.map((v, i) => [xAt(i), yAt(v)]);
  const linePts = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPts = coords.length === 1
    ? `${padL},${padT + plotH} ${padL},${coords[0][1].toFixed(1)} ${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)} ${coords[0][0].toFixed(1)},${padT + plotH}`
    : `${coords[0][0].toFixed(1)},${padT + plotH} ${linePts} ${coords.at(-1)[0].toFixed(1)},${padT + plotH}`;
  const midY = (padT + plotH / 2).toFixed(1);
  const avgY = avg !== null ? yAt(avg).toFixed(1) : null;
  const last = coords.at(-1);
  const hoverIdx = tpsChartHoverIdx !== null && tpsChartHoverIdx >= 0 && tpsChartHoverIdx < pts.length ? tpsChartHoverIdx : null;
  const hoverPt = hoverIdx !== null ? coords[hoverIdx] : null;
  $('tps-chart-peak').textContent = `${t('tpsPeak')} ${rate(Math.max(...pts))}`;
  $('tps-chart-avg-label').textContent = avg !== null ? `${t('tpsAvg')} ${rate(avg)}` : '—';
  $('tps-chart-hover').textContent = hoverIdx !== null ? `${rate(pts[hoverIdx])} tok/s` : '';
  svgEl.innerHTML = `<defs><linearGradient id="ag-panel-tps-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--pulse-accent)" stop-opacity="0.28"/><stop offset="100%" stop-color="var(--pulse-accent)" stop-opacity="0.02"/></linearGradient></defs>`
    + `<line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="var(--pulse-separator)" stroke-width="0.8"/>`
    + `<line x1="${padL}" y1="${midY}" x2="${W - padR}" y2="${midY}" stroke="var(--pulse-separator)" stroke-width="0.8" stroke-dasharray="2 3"/>`
    + `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--pulse-separator)" stroke-width="0.8"/>`
    + `<polygon points="${areaPts}" fill="url(#ag-panel-tps-grad)"/>`
    + (avgY !== null ? `<line x1="${padL}" y1="${avgY}" x2="${W - padR}" y2="${avgY}" stroke="var(--pulse-muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0.75"/>` : '')
    + (coords.length === 1
      ? `<line x1="${padL}" y1="${last[1].toFixed(1)}" x2="${last[0].toFixed(1)}" y2="${last[1].toFixed(1)}" stroke="var(--pulse-accent)" stroke-width="1.8" stroke-linecap="round"/>`
      : `<polyline points="${linePts}" fill="none" stroke="var(--pulse-accent)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`)
    + (hoverPt ? `<line x1="${hoverPt[0].toFixed(1)}" y1="${padT}" x2="${hoverPt[0].toFixed(1)}" y2="${padT + plotH}" stroke="var(--pulse-muted)" stroke-width="1" stroke-dasharray="2 2"/><circle cx="${hoverPt[0].toFixed(1)}" cy="${hoverPt[1].toFixed(1)}" r="3.4" fill="var(--pulse-accent)" stroke="var(--pulse-card)" stroke-width="1.4"/>` : '')
    + `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="${speed?.liveTiming?.isRunning ? '3.2' : '2.5'}" fill="var(--pulse-accent)" stroke="var(--pulse-card)" stroke-width="1.2"/>`;
}
function restartSampleTimer() {
  clearInterval(sampleTimer);
  sampleTimer = setInterval(() => {
    if (snapshot?.speed && isModelGenerating(snapshot.speed)) {
      sampleLiveStreamingTps();
      if (selectedCard === 'speed') renderTpsChart();
    }
  }, sampleIntervalMs);
}
function renderContextBreakdown(context) {
  const track = $('context-track'), list = $('context-breakdown');
  const hasCapacity = typeof context?.usedFraction === 'number';
  const items = context?.breakdown?.items;
  if (track) {
    if (items?.length) {
      const denom = context.maxTokens && context.maxTokens > 0 ? context.maxTokens : (context.breakdown.totalTokens || context.usedTokens || 1);
      const scale = denom > 0 && context.usedTokens > denom ? denom / context.usedTokens : 1;
      track.innerHTML = items.map(item => {
        const w = Math.max(0.8, Math.min(100, (item.tokens / denom) * 100 * scale));
        return `<i style="width:${w.toFixed(2)}%;background:${CTX_COLORS[item.key] || CTX_COLORS.other}" title="${t(CTX_LABELS[item.key] || 'ctxOther')}: ${count(item.tokens)}"></i>`;
      }).join('');
    } else {
      const fill = $('context-fill') || (() => { const i = document.createElement('i'); i.id = 'context-fill'; track.replaceChildren(i); return i; })();
      fill.style.width = hasCapacity ? `${Math.min(1, context.usedFraction) * 100}%` : '0%';
      fill.style.background = hasCapacity && context.usedFraction >= .9 ? 'var(--pulse-danger)' : 'var(--pulse-accent)';
    }
  }
  if (!list) return;
  if (!items?.length) { list.hidden = true; list.replaceChildren(); return; }
  list.hidden = false;
  const denom = context.maxTokens && context.maxTokens > 0 ? context.maxTokens : (context.breakdown.totalTokens || context.usedTokens || 1);
  list.replaceChildren(...items.map(item => {
    const col = CTX_COLORS[item.key] || CTX_COLORS.other;
    const name = t(CTX_LABELS[item.key] || 'ctxOther');
    const pctVal = denom > 0 ? (item.tokens / denom) * 100 : 0;
    const pctStr = pctVal >= 10 ? `${Math.round(pctVal)}%` : pctVal >= 0.1 ? `${pctVal.toFixed(1)}%` : '<0.1%';
    const rowEl = document.createElement('div');
    rowEl.className = 'ctx-row';
    rowEl.title = `${name}: ${count(item.tokens)}`;
    const sw = document.createElement('span'); sw.className = 'ctx-swatch'; sw.style.background = col;
    const nm = document.createElement('span'); nm.className = 'ctx-name'; nm.textContent = name;
    const tk = document.createElement('span'); tk.className = 'ctx-tok'; tk.textContent = compact(item.tokens);
    const pc = document.createElement('span'); pc.className = 'ctx-pct'; pc.textContent = pctStr;
    rowEl.append(sw, nm, tk, pc);
    return rowEl;
  }));
}

function render() {
  if (!snapshot) return;
  if(usageDashboard){
    const available=Boolean(snapshot.usage);
    if($('usage-entry'))$('usage-entry').hidden=!available;
    if($('est-entry'))$('est-entry').hidden=!available||!(snapshot.quotaEstimate?.groups?.length);
    if($('usage-today'))$('usage-today').textContent=compact(snapshot.usage?.todayTokens);
    if($('usage-month'))$('usage-month').textContent=compact(snapshot.usage?.monthTokens);
    usageDashboard.update(snapshot.usage);
  }
  const groups = snapshot.groups || [], speed = snapshot.speed;
  group = chooseGroup(groups, speed);
  const optionsKey = groups.map(g => g.id).join('|');
  const select = $('quota-group');
  if (select.dataset.options !== optionsKey) {
    select.replaceChildren(...(groups.length ? groups.map(g => new Option(groupLabel(g),g.id)) : [new Option(t('unavailableQuota'),'')]));
    select.dataset.options = optionsKey;
  }
  if (group) select.value = group.id;
  for (const element of document.querySelectorAll('.group-name')) element.textContent = group ? groupLabel(group) : '—';
  renderQuota('5h','five'); renderQuota('weekly','week');
  const avgVal = effectiveAvgTps(speed), latestVal = effectiveLatestTps(speed);
  const liveVal = isModelGenerating(speed) && typeof streamState.liveTps === 'number' ? streamState.liveTps : null;
  $('strip-tps').textContent = rate(liveVal !== null && liveVal > 0 ? liveVal : avgVal);
  $('speed-tab').title=rate(avgVal)+' tok/s';
  $('session-steps').textContent = speed ? t('rounds',{rounds:speed.rounds,steps:speed.steps}) : '';
  $('strip-model').textContent = speed?.model || t('waitingRequest');
  $('strip-model').title=$('strip-model').textContent;
  $('ttft').textContent = language.elapsed(speed?.ttftSeconds);
  const lastTpsStr = liveVal !== null ? rate(liveVal) : typeof latestVal === 'number' ? rate(latestVal) : speed?.latestRateStatus==='unreliable'?t('timingUnreliable'):speed?.latestRateStatus==='legacy'?t('ratePending'):rate(latestVal);
  const avgTpsStr = speed?.latestRateStatus==='legacy'?t('ratePending'):rate(avgVal);
  if ($('tps-last-avg')) $('tps-last-avg').textContent = `${lastTpsStr} / ${avgTpsStr}`;
  $('token-detail').textContent = speed ? `${count(speed.counts.responseOutput)} / ${count(speed.counts.thinkingOutput)}` : '—';
  syncCompletedTpsSample(speed);
  if (isModelGenerating(speed)) sampleLiveStreamingTps();
  renderTpsChart();
  updateLiveTiming();
  const savedNote=speed?.restoredFromHistory?' '+t('savedStats',{time:speed.savedAt?language.resetDate(speed.savedAt):'—'}):'';
  const saveWarning=snapshot.persistenceError?' '+t('saveFailed'):'';
  $('speed-basis').textContent = (speed?.counts?.thinkingOutput > 0 ? t('allBasis') : language.rateNote(speed))+savedNote+saveWarning;
  const cache=speed?.cache;
  const context=speed?.context,hasCapacity=typeof context?.usedFraction==='number';
  $('strip-context').textContent=hasCapacity?`${Math.round(context.usedFraction*100)}%`:'—';
  $('strip-context-size').textContent=context?`${compact(context.usedTokens)} / ${context.maxTokens===null?'—':compact(context.maxTokens)}`:'—';
  $('context-tab').title=context?t('contextTokens',{used:count(context.usedTokens),max:context.maxTokens===null?'—':count(context.maxTokens)}):t('contextUnknown');
  $('context-summary').textContent=hasCapacity?t('contextUsed',{used:Math.round(context.usedFraction*100),remaining:Math.round(context.remainingFraction*100)}):t('contextUnknown');
  $('context-tokens').textContent=context?t('contextTokens',{used:compact(context.usedTokens),max:context.maxTokens===null?'—':compact(context.maxTokens)}):'—';
  $('context-model').textContent=context?.model||'—';
  const restored=context&&(speed.contextRestored===true||speed.restoredFromHistory&&speed.contextRestored!==false);
  $('context-note').textContent=[context?t('contextBasis'):t('contextUnavailable'),restored?t('contextSaved',{time:speed.savedAt?language.resetDate(speed.savedAt):'—'}):'',hasCapacity&&context.usedFraction>1?t('contextExceeded'):''].filter(Boolean).join(' ');
  renderContextBreakdown(context);
  if(hasCapacity){$('context-track').setAttribute('aria-valuenow',String(Math.min(100,context.usedFraction*100)));$('context-track').setAttribute('aria-valuemin','0');$('context-track').setAttribute('aria-valuemax','100');}else $('context-track').removeAttribute('aria-valuenow');
  $('strip-cache').textContent=percent(cache?.hitRate);$('cache-rate').textContent=percent(cache?.hitRate);
  $('strip-cache-total').textContent=cache?.measuredRequests?compact(cache.totalTokens):'—';
  $('cache-tab').title=percent(cache?.hitRate)+(cache?.measuredRequests?' ('+count(cache.totalTokens)+')':'');
  for(const [field,id]of[['cachedTokens','cache-read'],['uncachedTokens','cache-miss'],['cacheWriteTokens','cache-write'],['outputTokens','cache-output']])$(id).textContent=cache?.measuredRequests?`${count(cache[field])} tok`:'—';
  $('cache-coverage').textContent=speed?(language.language==='zh-CN'?`${speed.rounds}轮 ${speed.steps}步 (${speed.measuredRequests}次)`:`${speed.rounds} turns, ${speed.steps} steps (${speed.measuredRequests})`):'—';
  $('cache-write-row').hidden=!(cache?.cacheWriteTokens>0);
  $('cache-note').textContent=[cache?.measuredRequests?t('cacheBasis'):t('cacheUnavailable'),cache?.measuredRequests&&cache.missingRequests?t('cacheMissing',{n:cache.missingRequests}):'',savedNote.trim(),saveWarning.trim()].filter(Boolean).join(' ');
  $('connection-dot').className = `connection-dot ${snapshot.connection}`;
  $('connection-dot').title = t(snapshot.connection === 'live'?'live':snapshot.connection === 'stale'?'stale':'offline');
  const timestamp = snapshot.quotaUpdatedAt ? new Date(snapshot.quotaUpdatedAt).toLocaleTimeString(language.language,{hour12:false}) : null;
  $('health-note').textContent = language.errorMessage(snapshot.error||snapshot.sessionError) || (timestamp ? t('health',{time:timestamp}) : t('firstUpdate'));
  $('health-note').classList.toggle('warning', snapshot.connection !== 'live' || !!snapshot.sessionError);
  const integration = snapshot.integration, ka = snapshot.keepAlive;
  let integrationMsg = '';
  if (integration && !['mounted', 'disabled'].includes(integration.state)) {
    if (ka?.status === 'repaired-restart-needed') {
      integrationMsg = language.language === 'zh-CN'
        ? '检测到 Antigravity 已更新，已自动保活修复内嵌状态条；重启 Antigravity 后即可恢复。'
        : 'Antigravity updated — inline status bar auto-repaired; restart Antigravity to activate.';
    } else if (ka?.status === 'staged-pending-exit') {
      integrationMsg = language.language === 'zh-CN'
        ? '检测到 Antigravity 已更新，已就绪自动保活修复；退出并重开 Antigravity 时将自动生效。'
        : 'Antigravity updated — auto-repair is staged and will apply automatically when Antigravity exits.';
    } else if (ka?.status === 'busy-retrying') {
      integrationMsg = language.language === 'zh-CN'
        ? '检测到 Antigravity 已更新，正在自动重试修复内嵌状态条…'
        : 'Antigravity updated; retrying automatic inline adapter repair…';
    } else {
      integrationMsg = language.language === 'zh-CN'
        ? '内嵌栏正在自动重连；此面板仍可查看统计。'
        : 'Inline widget is reconnecting automatically; statistics remain available in this panel.';
    }
  }
  $('integration-note').textContent = integrationMsg;
  updateCountdowns();
}

function updateCountdowns() {
  const now = Date.now() + serverOffset;
  for (const [window,prefix] of [['5h','five'],['weekly','week']]) {
    const bucket = group?.windows?.[window];
    $(`${prefix}-countdown`).textContent = language.countdown(bucket?.resetAt,now);
    $(`${prefix}-summary-countdown`).textContent=language.countdown(bucket?.resetAt,now,true);
    $(`${prefix}-summary-balance`).textContent=percent(bucket?.remaining);
    $(`${prefix}-summary-fill`).style.width=typeof bucket?.remaining==='number'?`${Math.min(100,Math.max(0,bucket.remaining*100))}%`:'0%';
    if (bucket?.resetAt && Date.parse(bucket.resetAt) <= now && snapshot?.connection === 'live' && now - lastExpiredRefresh > 30000) {
      lastExpiredRefresh = now; setTimeout(() => refresh(true),0);
    }
  }
}

function refreshBusy(busy){
  const button=$('refresh-button');button.setAttribute('aria-busy',String(busy));button.setAttribute('aria-disabled',String(busy));
  button.dataset.i18nAria=busy?'refreshing':'refreshStats';button.title=t(button.dataset.i18nAria);button.setAttribute('aria-label',button.title);
}
function refreshManually(){
  if(manualRequest)return;
  refreshBusy(true);const started=performance.now();
  manualRequest=(async()=>{
    try{if(pending)await refreshRequest;await refresh(true);}
    finally{
      const remaining=250-(performance.now()-started);
      if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
      refreshBusy(false);manualRequest=null;
    }
  })();
}
function refresh(force = false) {
  if (pending) return refreshRequest;
  pending = true;
  refreshRequest=(async()=>{
  try {
    const params = new URLSearchParams();
    if (host?.conversationId) params.set('conversationId',host.conversationId);
    if (force) params.set('force','1');
    const transport = host?.fetch ? host.fetch.bind(host) : fetch;
    const response = await transport(`/api/metrics?${params}`,{cache:'no-store'});
    if (!response.ok) throw new Error(t('panelUnavailable'));
    const value = await response.json();
    if (!['live','stale','offline'].includes(value.connection)) throw new Error(t('invalidData'));
    snapshot = value;
    if(Object.hasOwn(value,'theme'))themeController.setHostTheme(value.theme);
    if(value.preferences){if(value.preferences.usageGuideDismissed===true){usageGuideDismissed=true;usageDashboard?.syncGuideDismissed();}preferences.sync(value.preferences);}
    serverOffset = Date.parse(value.serverTime) - Date.now();
    if (!Number.isFinite(serverOffset)) serverOffset = 0;
    render();
  } catch (error) {
    if (snapshot) { snapshot.connection = 'stale'; snapshot.error = error.message; render(); }
    else { $('health-note').textContent = language.errorMessage(error.message); $('health-note').classList.add('warning'); }
  } finally {
    pending = false; refreshRequest=null;
    clearTimeout(timer);
    const fastPoll = !document.hidden && (selectedCard === 'speed' || snapshot?.speed?.liveTiming?.isRunning);
    timer = setTimeout(refresh, document.hidden ? 10000 : fastPoll ? Math.max(500, sampleIntervalMs) : 2200);
  }
  })();
  return refreshRequest;
}
$('quota-group').addEventListener('change', event => { selectedGroup = event.target.value; localSet('ag-pulse-group',selectedGroup); render(); });
$('refresh-button').addEventListener('click', refreshManually);
$('language-toggle').addEventListener('click',()=>{void preferences.toggle();});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('pagehide',()=>preferences.dispose());
window.addEventListener('pageshow',event=>{if(event.persisted)preferences=connectPreferences();});
setInterval(updateCountdowns,1000);
setInterval(()=>{if(snapshot?.speed?.liveTiming?.isRunning)updateLiveTiming();},200);
for(const pill of document.querySelectorAll('.sample-pill')){
  pill.setAttribute('aria-pressed',String(Number(pill.dataset.sampleMs)===sampleIntervalMs));
  pill.addEventListener('click',()=>{
    const ms=Number(pill.dataset.sampleMs);
    if(!SAMPLE_OPTIONS.includes(ms))return;
    sampleIntervalMs=ms;localSet('ag-pulse-tps-interval',String(ms));
    for(const p of document.querySelectorAll('.sample-pill'))p.setAttribute('aria-pressed',String(Number(p.dataset.sampleMs)===ms));
    restartSampleTimer();renderTpsChart();
  });
}
const chartSvg=$('tps-chart-svg');
if(chartSvg){
  chartSvg.addEventListener('pointermove',event=>{
    if(!tpsSeries.length)return;
    const rect=chartSvg.getBoundingClientRect();if(rect.width<=0)return;
    const ratio=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
    const idx=tpsSeries.length===1?0:Math.round(ratio*(tpsSeries.length-1));
    if(idx!==tpsChartHoverIdx){tpsChartHoverIdx=idx;renderTpsChart();}
  });
  chartSvg.addEventListener('pointerleave',()=>{if(tpsChartHoverIdx!==null){tpsChartHoverIdx=null;renderTpsChart();}});
}
restartSampleTimer();
if(window.__agPulseUsageFactory&&$('cache-card')){
  const section=document.createElement('div');section.id='usage-entry';section.hidden=true;
  section.innerHTML='<dl class="usage-summary"><div><dt id="usage-today-label"></dt><dd><strong id="usage-today"></strong><span class="usage-unit">Token</span></dd></div><div><dt id="usage-month-label"></dt><dd><strong id="usage-month"></strong><span class="usage-unit">Token</span></dd></div></dl><button type="button" id="open-usage"><span id="usage-open-label"></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
  $('cache-card').append(section);
  const css=document.createElement('style');
  css.textContent='#usage-entry{border-top:1px solid var(--pulse-separator);padding-top:13px;margin-top:14px}#usage-entry[hidden]{display:none}.usage-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding-bottom:13px;border-bottom:1px solid var(--pulse-separator)}.usage-summary>div{display:block;min-width:0;margin:0}.usage-summary dt{font-size:10px;line-height:16px;color:var(--pulse-muted);margin:0 0 5px}.usage-summary dd{display:flex;align-items:baseline;justify-content:flex-start;gap:5px;margin:0;white-space:nowrap;text-align:left;line-height:24px}.usage-summary strong{font-size:20px;font-weight:550;letter-spacing:-.5px;color:var(--pulse-foreground);font-variant-numeric:tabular-nums}.usage-unit{font-size:9px;letter-spacing:0;color:var(--pulse-muted)}#open-usage{position:relative;isolation:isolate;width:calc(100% + 12px);display:flex;align-items:center;justify-content:space-between;min-height:34px;gap:12px;margin:5px -6px -3px;padding:7px 6px;border:0;border-radius:6px;background:transparent;color:var(--pulse-label);font:inherit;font-size:11px;text-align:left;line-height:20px;cursor:pointer;transition:color 140ms ease}#open-usage::before{content:"";position:absolute;inset:0;border-radius:inherit;background:var(--pulse-hover);opacity:0;transform:scale(.96);transition:transform 200ms cubic-bezier(.22,1,.36,1),opacity 140ms ease;z-index:-1}#open-usage:hover{color:var(--pulse-foreground)}#open-usage:hover::before{opacity:1;transform:scale(1)}#open-usage:active::before{transform:scale(.97);transition-duration:75ms}#open-usage svg{width:14px;height:14px;color:var(--pulse-muted);flex:none;transition:transform 200ms cubic-bezier(.22,1,.36,1),color 140ms ease}#open-usage:hover svg{transform:translateX(3px);color:var(--pulse-foreground)}';
  document.head.append(css);
  const pricingRequest=async(input)=>{
    const transport=host?.fetch?host.fetch.bind(host):fetch;
    const response=await transport('/api/pricing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    const data=await response.json().catch(()=>({ok:false,error:'Pricing update failed'}));
    if(!response.ok)throw new Error(data?.error||'Pricing update failed');
    return data;
  };
  usageDashboard=window.__agPulseUsageFactory({root:document.body,language,setMarkup:(el,html)=>{el.innerHTML=html;},hostLabel:'Antigravity',guideDismissed:usageGuideDismissed,onDismissGuide:async()=>{const saved=await preferenceRequest({usageGuideDismissed:true});if(saved?.usageGuideDismissed!==true)throw Error('Usage guide could not be saved');usageGuideDismissed=true;usageDashboard?.syncGuideDismissed();},onLanguage:next=>preferences.choose(next),onRefresh:()=>refreshManually(),onPricing:pricingRequest});
  $('open-usage').addEventListener('click',()=>usageDashboard.open(snapshot?.usage,$('open-usage'),null,$('open-usage').getBoundingClientRect()));
  if($('context-card')){
    const estEntry=document.createElement('div');estEntry.id='est-entry';estEntry.hidden=true;
    estEntry.innerHTML='<button type="button" id="open-estimate"><span id="est-open-label"></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    $('context-card').append(estEntry);
    css.textContent+='#est-entry{border-top:1px solid var(--pulse-separator);margin-top:12px;padding-top:6px}#est-entry[hidden]{display:none}#open-estimate{position:relative;isolation:isolate;width:calc(100% + 12px);display:flex;align-items:center;justify-content:space-between;min-height:32px;gap:12px;margin:0 -6px -3px;padding:6px 6px;border:0;border-radius:6px;background:transparent;color:var(--pulse-label);font:inherit;font-size:11px;text-align:left;cursor:pointer;transition:color 140ms ease}#open-estimate::before{content:"";position:absolute;inset:0;border-radius:inherit;background:var(--pulse-hover);opacity:0;transform:scale(.96);transition:transform 200ms cubic-bezier(.22,1,.36,1),opacity 140ms ease;z-index:-1}#open-estimate:hover{color:var(--pulse-foreground)}#open-estimate:hover::before{opacity:1;transform:scale(1)}#open-estimate:active::before{transform:scale(.97);transition-duration:75ms}#open-estimate svg{width:14px;height:14px;color:var(--pulse-muted);flex:none;transition:transform 200ms cubic-bezier(.22,1,.36,1),color 140ms ease}#open-estimate:hover svg{transform:translateX(3px);color:var(--pulse-foreground)}';
    $('open-estimate').addEventListener('click',()=>usageDashboard.open(snapshot?.usage,$('open-estimate'),'estimate',$('open-estimate').getBoundingClientRect()));
  }
}
localize();
showCard('speed');
refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initPanel,{once:true});
else initPanel();
