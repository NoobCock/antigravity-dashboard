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
  if(changed&&animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches)cardMotion=$(`${name}-card`).animate([{opacity:.6,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:'cubic-bezier(.23,1,.32,1)'});
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
  $('strip-tps').textContent = rate(speed?.tps);
  $('speed-tab').title=rate(speed?.tps)+' tok/s';
  $('session-tps').textContent = rate(speed?.tps);
  $('latest-tps').textContent = speed?.latestRateStatus==='unreliable'?t('timingUnreliable'):speed?.latestRateStatus==='legacy'?t('ratePending'):rate(speed?.latestTps);
  $('request-count').textContent = t('sampleCount',{n:speed?.measuredRequests??0});
  $('session-steps').textContent = speed ? t('rounds',{rounds:speed.rounds,steps:speed.steps}) : '';
  $('strip-model').textContent = speed?.model || t('waitingRequest');
  $('strip-model').title=$('strip-model').textContent;
  $('model-time').textContent = language.elapsed(speed?.modelSeconds);
  $('tool-time').textContent = language.elapsed(speed?.toolSeconds);
  $('ttft').textContent = language.elapsed(speed?.ttftSeconds);
  $('token-detail').textContent = speed ? `${count(speed.counts.responseOutput)} / ${count(speed.counts.thinkingOutput)} tok` : '—';
  const savedNote=speed?.restoredFromHistory?' '+t('savedStats',{time:speed.savedAt?language.resetDate(speed.savedAt):'—'}):'';
  const saveWarning=snapshot.persistenceError?' '+t('saveFailed'):'';
  $('speed-basis').textContent = language.rateNote(speed)+savedNote+saveWarning;
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
  $('context-fill').style.width=hasCapacity?`${Math.min(1,context.usedFraction)*100}%`:'0%';
  $('context-fill').style.background=hasCapacity&&context.usedFraction>=.9?'var(--pulse-danger)':'';
  if(hasCapacity){$('context-track').setAttribute('aria-valuenow',String(Math.min(100,context.usedFraction*100)));$('context-track').setAttribute('aria-valuemin','0');$('context-track').setAttribute('aria-valuemax','100');}else $('context-track').removeAttribute('aria-valuenow');
  $('strip-cache').textContent=percent(cache?.hitRate);$('cache-rate').textContent=percent(cache?.hitRate);
  $('strip-cache-total').textContent=cache?.measuredRequests?`${compact(cache.totalTokens)} tok`:'— tok';
  $('cache-tab').title=percent(cache?.hitRate)+(cache?.measuredRequests?' ('+count(cache.totalTokens)+' tok)':'');
  for(const [field,id]of[['cachedTokens','cache-read'],['uncachedTokens','cache-miss'],['cacheWriteTokens','cache-write'],['outputTokens','cache-output']])$(id).textContent=cache?.measuredRequests?`${count(cache[field])} tok`:'—';
  $('cache-coverage').textContent=cache?.measuredRequests?`${count(cache.totalTokens)} tok`:'— tok';
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
    clearTimeout(timer); timer = setTimeout(refresh, document.hidden ? 10000 : 2200);
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
if(window.__agPulseUsageFactory&&$('cache-card')){
  const section=document.createElement('div');section.id='usage-entry';section.hidden=true;
  section.innerHTML='<dl class="usage-summary"><div><dt id="usage-today-label"></dt><dd><strong id="usage-today"></strong><span class="usage-unit">Token</span></dd></div><div><dt id="usage-month-label"></dt><dd><strong id="usage-month"></strong><span class="usage-unit">Token</span></dd></div></dl><button type="button" id="open-usage"><span id="usage-open-label"></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
  $('cache-card').append(section);
  const css=document.createElement('style');
  css.textContent='#usage-entry{border-top:1px solid var(--pulse-separator);padding-top:13px;margin-top:14px}#usage-entry[hidden]{display:none}.usage-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding-bottom:13px;border-bottom:1px solid var(--pulse-separator)}.usage-summary>div{display:block;min-width:0;margin:0}.usage-summary dt{font-size:10px;line-height:16px;color:var(--pulse-muted);margin:0 0 5px}.usage-summary dd{display:flex;align-items:baseline;justify-content:flex-start;gap:5px;margin:0;white-space:nowrap;text-align:left;line-height:24px}.usage-summary strong{font-size:20px;font-weight:550;letter-spacing:-.5px;color:var(--pulse-foreground);font-variant-numeric:tabular-nums}.usage-unit{font-size:9px;letter-spacing:0;color:var(--pulse-muted)}#open-usage{width:calc(100% + 12px);display:flex;align-items:center;justify-content:space-between;min-height:34px;gap:12px;margin:5px -6px -3px;padding:7px 6px;border:0;border-radius:6px;background:transparent;color:var(--pulse-label);font:inherit;font-size:11px;text-align:left;line-height:20px;cursor:pointer;transition:background 140ms ease,transform 120ms ease}#open-usage:hover{background:var(--pulse-hover);color:var(--pulse-foreground)}#open-usage:active{transform:scale(.98)}#open-usage svg{width:14px;height:14px;color:var(--pulse-muted);flex:none}';
  document.head.append(css);
  const pricingRequest=async(input)=>{
    const transport=host?.fetch?host.fetch.bind(host):fetch;
    const response=await transport('/api/pricing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    const data=await response.json().catch(()=>({ok:false,error:'Pricing update failed'}));
    if(!response.ok)throw new Error(data?.error||'Pricing update failed');
    return data;
  };
  usageDashboard=window.__agPulseUsageFactory({root:document.body,language,setMarkup:(el,html)=>{el.innerHTML=html;},hostLabel:'Antigravity',guideDismissed:usageGuideDismissed,onDismissGuide:async()=>{const saved=await preferenceRequest({usageGuideDismissed:true});if(saved?.usageGuideDismissed!==true)throw Error('Usage guide could not be saved');usageGuideDismissed=true;usageDashboard?.syncGuideDismissed();},onLanguage:next=>preferences.choose(next),onRefresh:()=>refreshManually(),onPricing:pricingRequest});
  $('open-usage').addEventListener('click',()=>usageDashboard.open(snapshot?.usage,$('open-usage')));
  if($('context-card')){
    const estEntry=document.createElement('div');estEntry.id='est-entry';estEntry.hidden=true;
    estEntry.innerHTML='<button type="button" id="open-estimate"><span id="est-open-label"></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    $('context-card').append(estEntry);
    css.textContent+='#est-entry{border-top:1px solid var(--pulse-separator);margin-top:12px;padding-top:6px}#est-entry[hidden]{display:none}#open-estimate{width:calc(100% + 12px);display:flex;align-items:center;justify-content:space-between;min-height:32px;gap:12px;margin:0 -6px -3px;padding:6px 6px;border:0;border-radius:6px;background:transparent;color:var(--pulse-label);font:inherit;font-size:11px;text-align:left;cursor:pointer;transition:background 140ms ease,transform 120ms ease}#open-estimate:hover{background:var(--pulse-hover);color:var(--pulse-foreground)}#open-estimate:active{transform:scale(.98)}#open-estimate svg{width:14px;height:14px;color:var(--pulse-muted);flex:none}';
    $('open-estimate').addEventListener('click',()=>usageDashboard.open(snapshot?.usage,$('open-estimate'),'estimate'));
  }
}
localize();
showCard('speed');
refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initPanel,{once:true});
else initPanel();
