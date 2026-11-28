// Self-contained main-world UI. Shadow DOM isolates styling from the host app.
module.exports = function installAgPulseInlineWidget() {
  if (window.__agPulseInlineInstalled) return;
  const host=()=>window.__agPulseRuntimeHost||window.agPulseHost;
  const report=(stage,details={})=>host()?.report?.({stage,...details});
  if (!document.documentElement) {
    document.addEventListener('DOMContentLoaded',installAgPulseInlineWidget,{once:true});
    return;
  }
  if (!host()) return;
  const localGet=key=>{try{return localStorage.getItem(key);}catch{return null;}};
  const localSet=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
  const language=window.__agPulseI18nFactory(localGet('ag-pulse-language'));
  const theme=window.__agPulseThemeFactory();
  const t=language.t;
  window.__agPulseInlineInstalled=true;
  report('boot',{hostFound:true});
  const ID='ag-pulse-status-bar';
  // Host-specific discovery stays outside the shared widget. The IDE has no
  // /c/<id> URL, and must never inherit the desktop's conversation fallback.
  const surface=window.__agPulseSurface;
  const setMarkup=(element,markup)=>{if(surface?.setMarkup)surface.setMarkup(element,markup);else element.innerHTML=markup;};
  let node=null,root=null,data=null,pending=false,cardName=null,hoverTimer=null,openTimer=null,warmUntil=0,lastConversation=null,lastFetch=0,lastExpiredRefresh=0,resizeObserver=null,groupMenu=null,themeController=null,changingCards=false;
  let miniName=null,cardPinned=false;
  const SAMPLE_OPTIONS=[500,1000,2000,5000];
  let sampleIntervalMs=SAMPLE_OPTIONS.includes(Number(localGet('ag-pulse-tps-interval')))?Number(localGet('ag-pulse-tps-interval')):1000;
  let tpsSeries=[],tpsSeriesConvo=null,tpsChartHoverIdx=null,sampleTimerId=null,liveTimerId=null;
  let streamState={convo:null,stepIdx:-1,baseBackendBytes:0,domBaseBytes:0,prevBytes:0,prevAt:0,liveTps:null,lastCompletedReqs:-1};
  const utf8Encoder=typeof TextEncoder==='function'?new TextEncoder():null;
  const domUtf8Len=str=>utf8Encoder?utf8Encoder.encode(str).length:str.length*2;
  let nativeUsageStyle=null,nativeUsageFrame=null,cardAnim=null,cardBodyAnim=null,miniAnim=null;
  const activeExitItems=new Set();
  const NATIVE_USAGE_STYLE_ID='ag-pulse-native-usage-css';
  const MOTION_EASE='cubic-bezier(0.22, 1, 0.36, 1)';
  const POPOVER_MS=240,MORPH_MS=260;
  const isTransientOverlay=el=>Boolean(el?.closest?.('[data-base-ui-portal],[role="menu"],[role="listbox"],[role="dialog"],[popover],[data-ag-pulse-quota-ext]'));
  const CTX_COLORS={chat:'#3b82f6',tools:'#f59e0b',system:'#8b5cf6',subagents:'#10b981',skills:'#ec4899',plugins:'#06b6d4',mcp:'#f97316',other:'#94a3b8'};
  const CTX_LABELS={chat:'ctxChat',tools:'ctxTools',system:'ctxSystem',subagents:'ctxSubagents',skills:'ctxSkills',plugins:'ctxPlugins',mcp:'ctxMcp',other:'ctxOther'};
  const HOVER_DELAY=250,WARM_WINDOW=350,LEAVE_DELAY=120;
  const isWarm=()=>Boolean(miniName||cardName||Date.now()<warmUntil);
  let chosen=localGet('ag-pulse-group'),group=null;
  let refreshRequest=null,manualRequest=null,requestEpoch=0,disposed=false;
  const convoCache=new Map();
  let switchTimer=null,lastFullFetch=0;
  function cacheSpeed(id,speed){
    if(!id||!speed)return;
    convoCache.delete(id);convoCache.set(id,speed);
    if(convoCache.size>40)convoCache.delete(convoCache.keys().next().value);
  }
  let composer=null,layoutFrame=null;
  let usageDashboard=null;
  let densityFrame=null,densityMotion=null,densityProbe=null;
  const densityMedia=matchMedia('(prefers-reduced-motion: reduce)');
  const densityEase='cubic-bezier(0.32,0.72,0,1)';
  let guideReady=false,guideDismissed=false,guideOpened=false,guideSaving=false,guideError=false,usageGuideDismissed=false;
  function syncGuide(value){if(value?.languageGuideDismissed===true)guideDismissed=true;if(value?.usageGuideDismissed===true){usageGuideDismissed=true;usageDashboard?.syncGuideDismissed();}}
  const preferences=language.connectPreferences({
    read:async()=>{const value=await host().getPreferences();syncGuide(value);return value;},
    write:async input=>{const value=await host().setPreferences(input);syncGuide(value);return value;},
    cache:value=>localSet('ag-pulse-language',value),changed:()=>{if(root){localize();render();tick();position();}},
  });
  void preferences.ready.then(()=>{guideReady=!preferences.error;scheduleLayout();});
  const icon=(name)=>({speed:'<path d="M3 12a6 6 0 1 1 10 0M8 9l3-4"/>',cache:'<ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 2 10 2 10 0V4M3 8c0 2 10 2 10 0"/>',five:'<circle cx="8" cy="8" r="5.6"/><path d="M8 4.7v3.6l2.3 1.4"/>',week:'<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M5 2v3m6-3v3M3 7h10"/>'}[name]);
  const svg=name=>`<svg viewBox="0 0 16 16" aria-hidden="true">${name==='context'?'<circle cx="8" cy="8" r="5.6"/><path d="M8 2.4V8l4.8 2.8"/>':icon(name)}</svg>`;
  const pct=n=>typeof n==='number'&&Number.isFinite(n)?`${(n*100).toFixed(1)}%`:'—';
  const rate=n=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:1,minimumFractionDigits:1}):'—';
  const count=n=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('en-US'):'—';
  const compact=n=>typeof n!=='number'||!Number.isFinite(n)?'—':n>=1e9?`${(n/1e9).toFixed(1).replace(/\.0$/,'')}B`:n>=1e6?`${(n/1e6).toFixed(1).replace(/\.0$/,'')}M`:n>=1e3?`${(n/1e3).toFixed(1).replace(/\.0$/,'')}K`:String(n);
  const fmtUsd=n=>typeof n!=='number'||!Number.isFinite(n)?'—':n>=100?'$'+n.toFixed(1):n>=1?'$'+n.toFixed(2):'$'+n.toFixed(3);
  const fmtShortUsd=n=>typeof n!=='number'||!Number.isFinite(n)?'—':n===0?'$0':n>=100?'$'+Math.round(n):n>=10?'$'+n.toFixed(1).replace(/\.0$/,''):'$'+n.toFixed(2).replace(/\.00$/,'');
  const seconds=language.elapsed;
  const timer=(at,compact=false)=>language.countdown(at,Date.now(),compact);
  const date=language.resetDate;
  const label=g=>/gemini/i.test(g?.name||'')?'Gemini':/claude|gpt/i.test(g?.name||'')?'Claude / GPT':g?.name||t('group');
  const $=id=>root?.getElementById(id);
  const text=(id,value)=>{const e=$(id);if(e&&e.textContent!==String(value))e.textContent=String(value);};
  const attribute=(element,name,value)=>{if(value===null){if(element.hasAttribute(name))element.removeAttribute(name);}else if(element.getAttribute(name)!==String(value))element.setAttribute(name,String(value));};
  const style=(element,name,value)=>{if(element.style.getPropertyValue(name)!==value)element.style.setProperty(name,value);};
  const hidden=(element,value)=>{if(element.hidden!==value)element.hidden=value;};
  const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const conversationId=()=>{
    if(surface)return surface.conversationId(composer);
    // Nested agents need not change the main window route. Read only the
    // nearest owner of this exact composer, never a sidebar/global chat ID.
    const subpane=(composer?.box||composer?.row)?.closest('[data-media-drop-scope="subpane"]');
    const subpaneConvo=subpane?.querySelector('[data-testid="subagent-tab-conversation"][data-cascade-id],[data-testid="side-question-tab-conversation"][data-cascade-id]');
    const owner=(composer?.box||composer?.row)?.closest('[data-cascade-id]')||subpaneConvo;
    if(owner){
      const id=owner.getAttribute('data-cascade-id');
      if(GUID.test(id||''))return id;
      if(owner.getAttribute('data-testid')!=='conversation-view'||id!=='conversation')return null;
    }
    return location.pathname.match(/\/c\/([0-9a-f-]{36})/i)?.[1]||null;
  };
  function syncConversation(){
    const id=conversationId();
    if(id===lastConversation)return false;
    lastConversation=id;requestEpoch++;pending=false;refreshRequest=null;lastFetch=0;
    clearTimeout(switchTimer);switchTimer=null;
    tpsSeries=[];tpsSeriesConvo=null;tpsChartHoverIdx=null;
    stopDensityMotion();densityFrame=null;densityProbe=null;
    manualRequest=null;refreshBusy(false);
    const cachedSpeed=id?convoCache.get(id)||null:null;
    const keepAccount=Boolean(data&&(data.groups?.length||data.usage||data.quotaEstimate));
    data=keepAccount?{...data,speed:cachedSpeed,sessionError:null}:{connection:'offline',groups:[],speed:cachedSpeed};
    if(!keepAccount)group=null;
    if(cachedSpeed)seedTpsSeries(cachedSpeed);
    hide({immediate:true});
    // Navigation has its own refresh budget. Show cached/history session info
    // immediately while debouncing heavy live trajectory RPCs across rapid clicks.
    const epoch=requestEpoch;
    const lightSwitch=keepAccount&&Date.now()-lastFullFetch<30000;
    if(!id){
      switchTimer=setTimeout(()=>{switchTimer=null;if(!disposed&&epoch===requestEpoch)refresh();},keepAccount?100:0);
    }else if(cachedSpeed){
      switchTimer=setTimeout(()=>{switchTimer=null;if(!disposed&&epoch===requestEpoch)refresh(false,{sessionOnly:lightSwitch});},140);
    }else if(!keepAccount){
      queueMicrotask(()=>{if(!disposed&&epoch===requestEpoch)refresh();});
    }else{
      queueMicrotask(()=>{
        if(disposed||epoch!==requestEpoch)return;
        void refresh(false,{preferCached:true,sessionOnly:lightSwitch}).then(res=>{
          if(disposed||epoch!==requestEpoch||res?.superseded)return;
          if(!res?.speed||res.speed.speedRefreshing){
            clearTimeout(switchTimer);
            switchTimer=setTimeout(()=>{switchTimer=null;if(!disposed&&epoch===requestEpoch)refresh(false,{sessionOnly:lightSwitch});},120);
          }
        });
      });
    }
    return true;
  }
  function localize(){
    attribute(node,'lang',language.language);
    for(const e of root.querySelectorAll('[data-i18n]')){const value=t(e.dataset.i18n);if(e.textContent!==value)e.textContent=value;}
    for(const e of root.querySelectorAll('[data-i18n-aria]'))attribute(e,'aria-label',t(e.dataset.i18nAria));
    for(const e of root.querySelectorAll('[data-i18n-aria][title]'))attribute(e,'title',t(e.dataset.i18nAria));
    for(const button of root.querySelectorAll('[data-language-choice]')){attribute(button,'aria-pressed',button.dataset.languageChoice===language.language);attribute(button,'data-save-failed',preferences.error);attribute(button,'title',preferences.error?t('languageSaveFailed'):button.textContent);}
    text('language-save-note',preferences.error?t('languageSaveFailed'):'');
    const zh=language.language==='zh-CN';
    text('usage-today-label',zh?'今日用量':'Today');text('usage-month-label',zh?'本月用量':'This month');
    text('usage-open-label',zh?'查看用量统计':'View token usage');
    if($('est-open-label'))text('est-open-label',t('estOpen'));
    renderNativeUsagePanel();
    updateGuide();
  }
  function stopDensityMotion(){
    const motion=densityMotion;densityMotion=null;
    if(!motion)return;
    for(const animation of motion.animations)animation.cancel();
    motion.stage.remove();delete node?.dataset.motion;
  }
  function densitySnapshot(previous){
    const pieces=new Map();
    for(const chip of root.querySelectorAll('.bar .chip'))for(const element of chip.children){
      if(!element.getClientRects().length)continue;
      const style=getComputedStyle(element);
      pieces.set(element,{rect:element.getBoundingClientRect(),opacity:1,font:style.font,color:style.color,icon:element.matches('svg,.context-ring')});
    }
    // Read interrupted copies before changing density. Reading them after the
    // final flex layout moves their parent would bake that shift into the new
    // start position and produce a visible jump on reversal.
    if(previous&&densityMotion)for(const [element,visual]of densityMotion.pieces){
      const piece=pieces.get(element)||densityMotion.sources.get(element);
      if(piece)pieces.set(element,{...piece,rect:visual.getBoundingClientRect(),opacity:Number(getComputedStyle(visual).opacity)});
    }
    return {pieces,rect:node.getBoundingClientRect(),model:composer.model,modelRect:previous?.model===composer.model?previous.modelRect:composer.model?.getBoundingClientRect(),row:composer.row};
  }
  function densityBounds(next){
    const row=next.row.getBoundingClientRect(),target=next.rect;
    let left=Math.max(row.left,composer.anchor?.getBoundingClientRect().right||0),right=Math.min(row.right,innerWidth);
    for(const control of document.querySelectorAll('button,[role="button"],a[href],input,select')){
      if(control===next.model||next.model?.contains(control)||control.contains(next.model))continue;
      const r=control.getBoundingClientRect();
      if(r.width<=0||r.height<=0||Math.min(target.bottom,r.bottom)-Math.max(target.top,r.top)<=1)continue;
      if(control.closest('[hidden],[inert]')||isTransientOverlay(control)||getComputedStyle(control).visibility==='hidden')continue;
      if(!next.row.parentElement.contains(control)){
        if(Math.min(right,r.right)-Math.max(left,r.left)<=0)continue;
        const x=(Math.max(left,r.left)+Math.min(right,r.right))/2,y=(Math.max(target.top,r.top)+Math.min(target.bottom,r.bottom))/2;
        const hit=document.elementFromPoint(x,y);
        if(hit!==control&&!control.contains(hit))continue;
      }
      if(r.right<=target.left+1)left=Math.max(left,r.right);
      else if(r.left>=target.right-1)right=Math.min(right,r.left);
      else return null;
    }
    return right-left>=target.width-2?{left,right}:null;
  }
  function clipDensityMotion(next){
    if(!densityMotion)return;
    const bounds=densityBounds(next);
    if(!bounds){stopDensityMotion();return;}
    // The ribbon follows its parent 1:1 while dragging. Keep its existing
    // compositor animation and clock; only crop to current safe host bounds.
    const stage=densityMotion.stage,r=stage.getBoundingClientRect();
    stage.style.clipPath=`inset(0px ${Math.max(0,r.right-bounds.right)}px 0px ${Math.max(0,bounds.left-r.left)}px)`;
  }
  function animateDensity(previous,next){
    // A narrow composer gives its space straight back to native controls. Only
    // inert visual copies move; the real icons immediately have safe hit boxes.
    // Copies share a clipped ribbon with the model selector's reveal, never the
    // send/mic/add controls. Neither flex widths nor host styles are animated.
    const interrupted=densityMotion;
    const modelOpacity=next.model?getComputedStyle(next.model).opacity:'1';
    stopDensityMotion();
    if(!Element.prototype.animate)return;
    const bounds=densityBounds(next);if(!bounds)return;
    const {left,right}=bounds,target=next.rect;
    const reduce=densityMedia.matches,duration=reduce?120:240;
    const stage=document.createElement('div');stage.className='density-stage';stage.inert=true;stage.setAttribute('aria-hidden','true');
    stage.style.cssText=`left:${left-target.left}px;top:0;width:${right-left}px;height:${target.height}px`;
    root.append(stage);
    const motion={stage,animations:[],pieces:new Map(),sources:new Map([...previous.pieces,...next.pieces])};densityMotion=motion;node.dataset.motion='density';
    const play=(element,frames,options={})=>{const animation=element.animate(frames,{duration,easing:densityEase,...options});motion.animations.push(animation);return animation;};
    for(const element of new Set([...previous.pieces.keys(),...next.pieces.keys()])){
      const from=previous.pieces.get(element),to=next.pieces.get(element),piece=to||from;
      const visual=element.cloneNode(true),end=to?.rect||from.rect;
      for(const part of [visual,...visual.querySelectorAll('*')])for(const attribute of [...part.attributes])if(attribute.name==='id'||attribute.name.startsWith('data-')||attribute.name.startsWith('aria-'))part.removeAttribute(attribute.name);
      const endX=Math.max(left,Math.min(right-end.width,end.left)),endY=end.top-target.top;
      visual.classList.add('density-piece');visual.style.cssText+=`;position:absolute;left:${endX-left}px;top:${endY}px;width:${end.width}px;height:${end.height}px;font:${piece.font};color:${piece.color};margin:0;pointer-events:none;display:block`;
      stage.append(visual);motion.pieces.set(element,visual);
      const start=from?.rect||end;
      const startX=Math.max(left,Math.min(right-start.width,start.left));
      const dx=reduce?0:startX-endX,dy=reduce?0:start.top-end.top;
      const startOpacity=from?.opacity??0,endOpacity=to?1:0;
      play(visual,[{transform:`translate(${dx}px,${dy}px)`,opacity:startOpacity},{transform:'translate(0,0)',opacity:endOpacity}],{fill:'both',...(piece.icon?{}:{duration:to?duration:80})});
      if(to)play(element,[{opacity:0},{opacity:0}],{fill:'both'});
    }
    // The host model name often goes from a caret to a full label as space is
    // returned. Let the outgoing labels leave before revealing that name.
    if(next.model&&previous.model===next.model&&(Math.abs(next.modelRect.width-previous.modelRect.width)>8||interrupted&&Number(modelOpacity)<.999)){
      play(next.model,[{opacity:interrupted?modelOpacity:0},{opacity:1}],{delay:reduce||interrupted?0:100,duration:reduce?120:interrupted?240:140,fill:'backwards'});
    }
    const finish=play(stage,[{opacity:1},{opacity:1}]);
    finish.onfinish=()=>{if(densityMotion===motion){stopDensityMotion();position();}};
  }
  function fit(){
    if(!node?.isConnected)return;
    // A modal owns input while open. Composer collision scans behind its
    // backdrop cannot improve its layout and can hide its hosting strip.
    if(usageDashboard?.isOpen){stopDensityMotion();return;}
    reserveNativeSpace();
    const bar=root.querySelector('.bar'),oldDensity=node.dataset.density,oldReady=node.dataset.layout==='ready';
    let previous=densityFrame;
    if(['compact','narrow','context-only'].some(c=>node.classList.contains(c)))node.classList.remove('compact','narrow','context-only');
    // Flex shrink alone does not constrain nowrap children or protect controls
    // positioned outside the flex flow (e.g. Agent Manager window buttons).
    const fits=()=>{
      const rect=node.getBoundingClientRect(),row=composer.row.getBoundingClientRect();
      const intersects=other=>Math.min(rect.right,other.right)-Math.max(rect.left,other.left)>1&&Math.min(rect.bottom,other.bottom)-Math.max(rect.top,other.top)>1;
      if(bar.scrollWidth>bar.clientWidth+2||rect.width<=0||rect.left< -1||rect.right>innerWidth+1||rect.top< -1||rect.bottom>innerHeight+1||rect.left<row.left-1||rect.right>row.right+1)return false;
      if(!nativeComfortable())return false;
      if(composer.kind==='subagent'&&intersects(composer.anchor.getBoundingClientRect()))return false;
      for(const control of document.querySelectorAll('button,[role="button"],a[href],input,select,[contenteditable="true"]')){
        const other=control.getBoundingClientRect();
        if(other.width<=0||other.height<=0||!intersects(other))continue;
        if(control.closest('[hidden],[inert]')||isTransientOverlay(control)||getComputedStyle(control).visibility==='hidden')continue;
        // Scrolling messages can put clipped/covered links underneath the
        // fixed composer. Their rectangles alone are not a visible collision.
        // Always reserve local actions; other controls must actually paint at
        // the intersection (e.g. a floating jump-to-bottom button).
        if(composer.row.parentElement.contains(control))return false;
        const left=Math.max(rect.left,other.left),right=Math.min(rect.right,other.right),top=Math.max(rect.top,other.top),bottom=Math.min(rect.bottom,other.bottom);
        for(const [x,y]of [[(left+right)/2,(top+bottom)/2],[left+.5,top+.5],[right-.5,top+.5],[left+.5,bottom-.5],[right-.5,bottom-.5]]){
          const hit=document.elementFromPoint(x,y);
          if(hit===control||control.contains(hit))return false;
        }
      }
      return true;
    };
    let safe=fits();
    const rowWidth=composer.row.getBoundingClientRect().width;
    const probeKey=()=>node.style.cssText.replace(/--pulse-native-room:[^;]+;?/g,'')+'|'+language.language+'|'+lastConversation+'|'+bar.textContent+'|'+$('dot').className+'|'+getComputedStyle(composer.row).gap+'|'+Array.from(composer.row.querySelectorAll('button,[role="button"],a[href],input,select')).filter(c=>c!==composer.model&&!c.contains(composer.model)).map(c=>c.getBoundingClientRect().width).join(',');
    if(oldDensity==='icons'){
      const key=probeKey();
      // Twelve pixels of recovery headroom prevents threshold chatter. Shrinking
      // or scrolling in icon mode never toggles back to full just to measure it.
      if(!densityProbe||key!==densityProbe.key||rowWidth>=densityProbe.width+12){
        previous=densitySnapshot(previous);node.classList.remove('icons-only');safe=fits();
        if(!safe){node.classList.add('icons-only');safe=fits();densityProbe={key,width:rowWidth};}
        else densityProbe=null;
      }
    }else if(!safe){
      previous=densitySnapshot(previous);node.classList.add('icons-only');safe=fits();densityProbe={key:probeKey(),width:rowWidth};
    }
    node.dataset.density=node.classList.contains('icons-only')?'icons':'full';
    const state=safe?'ready':'blocked';
    if(node.dataset.layout!==state){node.dataset.layout=state;node.inert=!safe;if(!safe)hide();}
    const changed=safe&&oldReady&&previous?.row===composer.row&&oldDensity!==node.dataset.density;
    const next=changed?densitySnapshot():{rect:node.getBoundingClientRect(),model:composer.model,modelRect:composer.model?.getBoundingClientRect(),row:composer.row};
    if(changed)animateDensity(previous,next);
    else if(!safe||previous?.row!==composer.row||previous?.model!==composer.model)stopDensityMotion();
    else if(densityMotion)clipDensityMotion(next);
    densityFrame=next;
    updateGuide();
  }
  function badgeTextRects(badge){
    if(!badge?.isConnected)return [];
    const walker=document.createTreeWalker(badge,NodeFilter.SHOW_TEXT),range=document.createRange(),rects=[];
    for(let text=walker.nextNode();text;text=walker.nextNode()){
      if(!text.textContent.trim()||text.parentElement?.closest('svg,[hidden],[inert]')||getComputedStyle(text.parentElement).visibility==='hidden')continue;
      range.selectNodeContents(text);rects.push(...range.getClientRects());
    }
    return rects.filter(r=>r.width>0&&r.height>0);
  }
  function captureNative(found){
    const branch=found.branch,r=branch.getBoundingClientRect();
    const baseline={height:r.height,icons:Array.from(branch.querySelectorAll('svg')).map(icon=>({icon,width:icon.getBoundingClientRect().width})),reserve:0};
    if(found.kind==='ide')baseline.reserve=surface.nativeReserve(found);
    if(found.kind==='subagent'){
      const badge=found.anchor,style=getComputedStyle(badge);
      // Summed glyph fragments recover intrinsic text width even if the host
      // is already wrapping the badge when we first attach.
      const textWidth=badgeTextRects(badge).reduce((sum,rect)=>sum+rect.width,0);
      const iconWidth=badge.querySelector('svg')?.getBoundingClientRect().width||0;
      const natural=textWidth+Math.max(iconWidth,12)+(parseFloat(style.columnGap)||0)+(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0);
      baseline.reserve=Math.ceil(Math.max(badge.getBoundingClientRect().width,natural)+badge.getBoundingClientRect().left-r.left+(parseFloat(getComputedStyle(branch).paddingRight)||0));
    }
    return baseline;
  }
  function nativeComfortable(){
    const baseline=composer.native;
    if(!baseline)return true;
    if(composer.branch.getBoundingClientRect().height>baseline.height+1)return false;
    if(baseline.icons.some(({icon,width})=>icon.isConnected&&icon.getBoundingClientRect().width<width-.5))return false;
    if(composer.kind==='ide'&&composer.branch.getBoundingClientRect().width<baseline.reserve-1)return false;
    if(composer.kind==='subagent'){
      if(composer.branch.getBoundingClientRect().width<baseline.reserve-1)return false;
      const lines=new Set(badgeTextRects(composer.anchor).map(r=>Math.round(r.top)));
      if(lines.size>1)return false;
    }
    return true;
  }
  function reserveNativeSpace(){
    if(!['subagent','ide'].includes(composer.kind)){if(node.style.getPropertyValue('--pulse-native-room'))node.style.removeProperty('--pulse-native-room');if(node.classList.contains('native-no-room'))node.classList.remove('native-no-room');return;}
    const row=composer.row,style=getComputedStyle(row),siblings=Array.from(row.children).filter(e=>e!==node&&e!==composer.branch&&e.getClientRects().length);
    const room=row.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0)-composer.native.reserve-siblings.reduce((sum,e)=>{const s=getComputedStyle(e);return sum+e.getBoundingClientRect().width+(parseFloat(s.marginLeft)||0)+(parseFloat(s.marginRight)||0);},0)-(parseFloat(style.columnGap)||0)*(siblings.length+1)-10;
    const width=`${Math.max(0,Math.floor(room))}px`;if(node.style.getPropertyValue('--pulse-native-room')!==width)node.style.setProperty('--pulse-native-room',width);
    // A hidden ribbon must release its flex space as well as its hit targets.
    // The budget is independent of our own rectangle, so it recovers directly
    // when the sidebar is closed, without probing the native badge each frame.
    node.classList.toggle('native-no-room',room<76);
  }
  function scheduleLayout(){
    if(layoutFrame!==null)return;
    layoutFrame=requestAnimationFrame(()=>{layoutFrame=null;mount();fit();position();});
  }
  function observeComposer(){
    resizeObserver?.disconnect();
    resizeObserver??=new ResizeObserver(scheduleLayout);
    for(const element of new Set([node,composer.row,composer.row.parentElement,composer.branch,composer.editor]))resizeObserver.observe(element);
  }
  function composerLayout({row,editor,branch}){
    // Containment alone can join an app header and a distant message editor.
    // Accept only a horizontal, normal-flow action row local to that editor.
    const style=getComputedStyle(row);
    if(!['flex','inline-flex'].includes(style.display)||style.flexDirection!=='row'||['absolute','fixed'].includes(style.position)||row.closest('header,[role="banner"]'))return false;
    if(['absolute','fixed'].includes(getComputedStyle(branch).position))return false;
    const r=row.getBoundingClientRect(),e=editor.getBoundingClientRect(),p=row.parentElement.getBoundingClientRect();
    const gap=Math.max(0,r.top-e.bottom,e.top-r.bottom);
    const overlap=Math.min(r.bottom,e.bottom)-Math.max(r.top,e.top);
    return r.width>0&&r.height>0&&e.width>0&&e.height>0&&gap<=48&&overlap<=2&&Math.min(r.right,e.right)>Math.max(r.left,e.left)&&p.height<=e.height+r.height+96;
  }
  function closeGroup(){for(const e of root?.querySelectorAll('.group-menu')||[])e.hidden=true;for(const e of root?.querySelectorAll('.group-trigger')||[])e.setAttribute('aria-expanded','false');groupMenu=null;}
  // Pointer clicks and dialog focus restoration leave buttons focused after
  // the pointer departs. Only keyboard-visible focus keeps a card engaged.
  // The explicit first-use action moves focus into language choices. Keep
  // that guided destination available until the user chooses or leaves it.
  const cardEngaged=()=>Boolean((cardPinned&&cardName)||root?.activeElement?.matches(':focus-visible')||(guideOpened&&!guideDismissed&&cardName==='context'&&root?.activeElement?.matches('[data-language-choice]'))||groupMenu||node?.matches(':hover')||root?.querySelector('.card:not([hidden]):not([data-exit-ghost]):hover'));
  function cardVisibility(element,visible){
    if(visible){hidden(element,false);if(element.hasAttribute('popover')&&!element.matches(':popover-open'))element.showPopover();}
    else {if(element.hasAttribute('popover')&&element.matches(':popover-open'))element.hidePopover();hidden(element,true);}
  }
  function zeroShadow(s){
    if(!s||s==='none')return 'none';
    return s.replace(/rgba?\(([^)]+)\)/g,(_,inner)=>{
      const p=inner.split(/[\s,/]+/).filter(Boolean);
      return p.length>=3?`rgba(${p[0]}, ${p[1]}, ${p[2]}, 0)`:'rgba(0, 0, 0, 0)';
    });
  }
  function popoverFrames(el,anchorBtn,blurPx,direction='open',minScale=0.62){
    const r=el.getBoundingClientRect();
    const ar=anchorBtn?.isConnected?anchorBtn.getBoundingClientRect():null;
    const above=el.dataset.side!=='below';
    const ax=ar&&r.width>0?Math.max(14,Math.min(r.width-14,(ar.left+ar.width/2)-r.left)):r.width/2;
    const oy=above?`${(r.height+8).toFixed(1)}px`:'-8px';
    const origin=`${ax.toFixed(1)}px ${oy}`;
    const dy=above?14:-14;
    const restSh=getComputedStyle(el).boxShadow;
    const clearSh=zeroShadow(restSh);
    const closed={transformOrigin:origin,opacity:0,transform:`translate3d(0,${dy}px,0) scale(${minScale})`,backdropFilter:'blur(0px)',webkitBackdropFilter:'blur(0px)',boxShadow:clearSh};
    const open={transformOrigin:origin,opacity:1,transform:'translate3d(0,0,0) scale(1)',backdropFilter:`blur(${blurPx}px)`,webkitBackdropFilter:`blur(${blurPx}px)`,boxShadow:restSh};
    if(direction==='open'){
      const midScale=minScale+(1-minScale)*0.45;
      const midDy=dy*0.55;
      return [
        closed,
        {offset:0.22,transformOrigin:origin,opacity:0.75,transform:`translate3d(0,${midDy.toFixed(2)}px,0) scale(${midScale.toFixed(4)})`},
        open,
      ];
    }
    const midScale=1-(1-minScale)*0.68;
    const midDy=dy*0.68;
    return [
      open,
      {offset:0.42,transformOrigin:origin,opacity:0.74,transform:`translate3d(0,${midDy.toFixed(2)}px,0) scale(${midScale.toFixed(4)})`},
      closed,
    ];
  }
  function buildMorphFrames(fromRect,toRect,{fromRadius=7,toRadius=13,restShadow='none',blurPx=16,direction='open'}={}){
    if(!fromRect||!toRect||fromRect.width<6||fromRect.height<6||toRect.width<20||toRect.height<20)return null;
    const steps=16;
    const sx0=Math.max(0.05,fromRect.width/toRect.width);
    const sy0=Math.max(0.04,fromRect.height/toRect.height);
    const dx0=fromRect.left-toRect.left;
    const dy0=fromRect.top-toRect.top;
    const clearSh=zeroShadow(restShadow);
    const shellFrames=[],bodyFrames=[];
    for(let i=0;i<=steps;i++){
      const t=i/steps;
      const p=direction==='open'?t:1-t;
      const cx=sx0+(1-sx0)*p;
      const cy=sy0+(1-sy0)*p;
      const tx=dx0*(1-p);
      const ty=dy0*(1-p);
      const rad=fromRadius+(toRadius-fromRadius)*p;
      const shellOp=direction==='open'?Math.min(1,0.25+p*0.95):(p<0.24?p/0.24:1);
      const sf={
        offset:t,
        transformOrigin:'0 0',
        transform:`translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${cx.toFixed(5)},${cy.toFixed(5)})`,
        borderRadius:`${(rad/cx).toFixed(2)}px / ${(rad/cy).toFixed(2)}px`,
        opacity:Number(shellOp.toFixed(4)),
      };
      if(i===0){
        sf.boxShadow=direction==='open'?clearSh:restShadow;
        sf.backdropFilter=direction==='open'?'blur(0px)':`blur(${blurPx}px)`;
        sf.webkitBackdropFilter=sf.backdropFilter;
      }else if(i===steps){
        sf.boxShadow=direction==='open'?restShadow:clearSh;
        sf.backdropFilter=direction==='open'?`blur(${blurPx}px)`:'blur(0px)';
        sf.webkitBackdropFilter=sf.backdropFilter;
      }
      shellFrames.push(sf);
      const u=Math.min(1,Math.max(cx,cy));
      const bodyOp=Math.max(0,Math.min(1,(p-0.1)/0.75));
      bodyFrames.push({
        offset:t,
        transformOrigin:'0 0',
        transform:`scale(${(u/cx).toFixed(5)},${(u/cy).toFixed(5)})`,
        opacity:Number(bodyOp.toFixed(4)),
      });
    }
    return {shellFrames,bodyFrames};
  }
  function clearExitStage(){
    for(const item of activeExitItems){item.anim?.cancel();item.bodyAnim?.cancel();item.ghost?.remove();}
    activeExitItems.clear();
    const stage=$('exit-stage');
    if(stage)cardVisibility(stage,false);
  }
  function playExitGhost(sourceEl,keyframes,options,bodyKeyframes=null){
    if(disposed||densityMedia.matches||!sourceEl?.animate)return;
    const stage=$('exit-stage');
    if(!stage)return;
    const r=sourceEl.getBoundingClientRect();
    if(r.width<6||r.height<6)return;
    const ghost=sourceEl.cloneNode(true);
    for(const grad of ghost.querySelectorAll('#ag-tps-grad'))grad.id='ag-tps-grad-exit';
    for(const poly of ghost.querySelectorAll('[fill="url(#ag-tps-grad)"]'))poly.setAttribute('fill','url(#ag-tps-grad-exit)');
    ghost.removeAttribute('id');ghost.removeAttribute('popover');
    for(const child of ghost.querySelectorAll('[id],[popover]')){
      if(child.id!=='ag-tps-grad-exit')child.removeAttribute('id');
      child.removeAttribute('popover');
    }
    ghost.hidden=false;
    ghost.dataset.exitGhost='1';
    ghost.style.cssText+=`;display:block!important;position:fixed!important;left:${r.left}px!important;top:${r.top}px!important;width:${r.width}px!important;height:${r.height}px!important;max-height:none!important;margin:0!important;pointer-events:none!important;overflow:hidden!important;`;
    cardVisibility(stage,true);
    stage.append(ghost);
    const entry={ghost,anim:null,bodyAnim:null};
    activeExitItems.add(entry);
    const cleanup=()=>{
      if(!activeExitItems.has(entry))return;
      activeExitItems.delete(entry);
      entry.bodyAnim?.cancel();
      ghost.remove();
      if(!activeExitItems.size&&stage.isConnected)cardVisibility(stage,false);
    };
    try{
      const bodyEl=bodyKeyframes?ghost.querySelector('.card-body'):null;
      if(bodyEl?.animate)entry.bodyAnim=bodyEl.animate(bodyKeyframes,options);
      entry.anim=ghost.animate(keyframes,options);
      entry.anim.onfinish=cleanup;
      entry.anim.oncancel=cleanup;
    }catch{cleanup();}
  }
  function hideMini({immediate=false}={}){
    const prev=miniName;
    miniName=null;
    miniAnim?.cancel();miniAnim=null;
    if(!immediate&&prev){
      const prevEl=$(`${prev}-mini`);
      if(prevEl&&!prevEl.hidden){
        const frames=popoverFrames(prevEl,root?.querySelector(`[data-card="${prev}"]`),12,'close',0.68);
        playExitGhost(prevEl,frames,{duration:POPOVER_MS,easing:MOTION_EASE});
      }
    }
    for(const el of root?.querySelectorAll('.mini-card:not([data-exit-ghost])')||[])cardVisibility(el,false);
    updateGuide();
  }
  function showMini(name){
    if(disposed||!node?.isConnected||usageDashboard?.isOpen||node.dataset.layout==='blocked'||cardName)return;
    const mini=$(`${name}-mini`);if(!mini)return;
    const prev=miniName;
    const entering=prev!==name||mini.hidden;
    if(prev&&prev!==name){
      const prevEl=$(`${prev}-mini`);
      if(prevEl&&!prevEl.hidden){
        playExitGhost(prevEl,popoverFrames(prevEl,root?.querySelector(`[data-card="${prev}"]`),12,'close',0.68),{duration:POPOVER_MS,easing:MOTION_EASE});
        cardVisibility(prevEl,false);
      }
    }
    miniName=name;
    for(const el of root.querySelectorAll('.mini-card:not([data-exit-ghost])'))cardVisibility(el,el.id===`${name}-mini`);
    if(name==='speed')updateLiveTiming();
    updateGuide();
    positionMini();
    if(entering&&!densityMedia.matches&&mini.animate){
      miniAnim?.cancel();
      const frames=popoverFrames(mini,root?.querySelector(`[data-card="${name}"]`),12,'open',0.68);
      miniAnim=mini.animate(frames,{duration:POPOVER_MS,easing:MOTION_EASE});
    }
  }
  function positionMini(){
    if(!miniName)return;
    const mini=$(`${miniName}-mini`),button=root?.querySelector(`[data-card="${miniName}"]`);
    if(!mini||mini.hidden||!button)return;
    const rect=button.getBoundingClientRect(),width=Math.min(miniName==='context'?184:198,window.innerWidth-24);
    style(mini,'width',`${width}px`);
    style(mini,'left',`${Math.min(window.innerWidth-width-12,Math.max(12,rect.left+rect.width/2-width/2))}px`);
    const roomAbove=rect.top-16,roomBelow=window.innerHeight-rect.bottom-16;
    const height=mini.offsetHeight||44;
    const useAbove=height<=roomAbove||roomAbove>=roomBelow;
    style(mini,'top',`${Math.max(12,useAbove?rect.top-height-8:rect.bottom+8)}px`);
    attribute(mini,'data-side',useAbove?'above':'below');
  }
  function animateCardEntry(card,name,fromRect=null,fromRadius=7){
    if(!card||densityMedia.matches||!card.animate)return;
    cardAnim?.cancel();cardAnim=null;
    cardBodyAnim?.cancel();cardBodyAnim=null;
    if(fromRect){
      const toRect=card.getBoundingClientRect();
      const restSh=getComputedStyle(card).boxShadow;
      const m=buildMorphFrames(fromRect,toRect,{fromRadius,toRadius:13,restShadow:restSh,blurPx:16,direction:'open'});
      if(m){
        const prevOv=card.style.overflow;
        card.style.overflow='hidden';
        const bodyEl=card.querySelector('.card-body');
        if(bodyEl?.animate)cardBodyAnim=bodyEl.animate(m.bodyFrames,{duration:MORPH_MS,easing:MOTION_EASE});
        const anim=card.animate(m.shellFrames,{duration:MORPH_MS,easing:MOTION_EASE});
        cardAnim=anim;
        const restore=()=>{if(cardAnim===anim){cardAnim=null;cardBodyAnim=null;card.style.overflow=prevOv;}};
        anim.onfinish=restore;anim.oncancel=restore;
        return;
      }
    }
    const anchorBtn=root?.querySelector(`[data-card="${name}"]`);
    cardAnim=card.animate(popoverFrames(card,anchorBtn,16,'open'),{duration:POPOVER_MS,easing:MOTION_EASE});
  }
  function hide({keepWarm=false,immediate=false}={}){
    clearTimeout(openTimer);openTimer=null;
    clearTimeout(hoverTimer);hoverTimer=null;
    if(!keepWarm)warmUntil=0;
    cardAnim?.cancel();cardAnim=null;
    cardBodyAnim?.cancel();cardBodyAnim=null;
    const prevName=cardName;
    cardPinned=false;
    if(immediate)clearExitStage();
    hideMini({immediate});
    if(!immediate&&prevName){
      const activeCard=$(`${prevName}-card`);
      if(activeCard&&!activeCard.hidden){
        const anchorBtn=root?.querySelector(`[data-card="${prevName}"]`);
        const fromRect=activeCard.getBoundingClientRect();
        const chipRect=anchorBtn?.getBoundingClientRect();
        const restSh=getComputedStyle(activeCard).boxShadow;
        const m=chipRect?buildMorphFrames(chipRect,fromRect,{fromRadius:6,toRadius:13,restShadow:restSh,blurPx:16,direction:'close'}):null;
        if(m)playExitGhost(activeCard,m.shellFrames,{duration:MORPH_MS,easing:MOTION_EASE},m.bodyFrames);
        else playExitGhost(activeCard,popoverFrames(activeCard,anchorBtn,16,'close'),{duration:POPOVER_MS,easing:MOTION_EASE});
      }
    }
    changingCards=true;
    try{closeGroup();cardName=null;for(const e of root?.querySelectorAll('[data-card]')||[])e.setAttribute('aria-expanded','false');for(const e of root?.querySelectorAll('.card:not([data-exit-ghost])')||[])cardVisibility(e,false);}
    finally{changingCards=false;}
    updateGuide();
  }
  function show(name,{pinned=false,morphFrom=null,morphFromRadius=7}={}){
    if(disposed||!node?.isConnected||changingCards||usageDashboard?.isOpen||node.dataset.layout==='blocked')return;
    const entering=cardName!==name;
    const prevName=cardName;
    if(entering)closeGroup();
    clearTimeout(hoverTimer);hoverTimer=null;
    clearTimeout(openTimer);openTimer=null;
    clearExitStage();
    if(entering&&prevName){
      const prevCard=$(`${prevName}-card`);
      if(prevCard&&!prevCard.hidden){
        const prevBtn=root?.querySelector(`[data-card="${prevName}"]`);
        const fromRect=prevCard.getBoundingClientRect();
        const chipRect=prevBtn?.getBoundingClientRect();
        const restSh=getComputedStyle(prevCard).boxShadow;
        const m=chipRect?buildMorphFrames(chipRect,fromRect,{fromRadius:6,toRadius:13,restShadow:restSh,blurPx:16,direction:'close'}):null;
        if(m)playExitGhost(prevCard,m.shellFrames,{duration:MORPH_MS,easing:MOTION_EASE},m.bodyFrames);
        else playExitGhost(prevCard,popoverFrames(prevCard,prevBtn,16,'close'),{duration:POPOVER_MS,easing:MOTION_EASE});
      }
    }
    hideMini({immediate:true});
    cardPinned=Boolean(pinned);
    cardName=name;warmUntil=0;
    for(const e of root.querySelectorAll('[data-card]'))e.setAttribute('aria-expanded',String(e.dataset.card===name));
    changingCards=true;
    try{for(const e of root.querySelectorAll('.card:not([data-exit-ghost])'))cardVisibility(e,e.id===`${name}-card`);}
    finally{changingCards=false;}
    if(name==='speed'){renderTpsChart();updateLiveTiming();}
    updateGuide();
    position();
    if(entering)animateCardEntry($(`${name}-card`),name,morphFrom,morphFromRadius);
  }
  function hoverChip(name){
    clearTimeout(hoverTimer);hoverTimer=null;
    if(cardName)return;
    if(isWarm()){
      clearTimeout(openTimer);openTimer=null;
      showMini(name);
    }else{
      clearTimeout(openTimer);
      const anchor=node,chip=root?.querySelector(`[data-card="${name}"]`),editor=composer?.editor,conversation=conversationId();
      openTimer=setTimeout(()=>{
        openTimer=null;
        // A host route/composer replacement can detach the chip without a
        // pointerleave. Never show a stale or disconnected top-layer popover.
        if(disposed||node!==anchor||!anchor?.isConnected||!chip?.isConnected||!chip.matches(':hover')||composer?.editor!==editor||conversationId()!==conversation||cardName)return;
        showMini(name);
      },HOVER_DELAY);
    }
  }
  function leaveChip(name){
    clearTimeout(openTimer);openTimer=null;
    if(miniName===name){
      warmUntil=Date.now()+WARM_WINDOW;
      clearTimeout(hoverTimer);
      hoverTimer=setTimeout(()=>{
        hoverTimer=null;
        if(miniName&&!root?.querySelector(`[data-card="${miniName}"]`)?.matches(':hover'))hideMini();
      },LEAVE_DELAY);
    }
  }
  function scheduleHide(){
    clearTimeout(openTimer);openTimer=null;
    clearTimeout(hoverTimer);hoverTimer=null;
    if(miniName){
      warmUntil=Date.now()+WARM_WINDOW;
      hoverTimer=setTimeout(()=>{hoverTimer=null;if(!node?.matches(':hover'))hideMini();},LEAVE_DELAY);
    }
    if(cardPinned&&cardName)return;
    // Measure the warm window from pointer departure, not the later hide.
    if(cardName){
      warmUntil=Date.now()+WARM_WINDOW;
      hoverTimer=setTimeout(()=>{hoverTimer=null;if(!cardEngaged())hide({keepWarm:true});},LEAVE_DELAY);
    }
  }
  function position(){
    positionGuide();
    positionMini();
    if(!cardName)return;
    const button=root.querySelector(`[data-card="${cardName}"]`),card=$(`${cardName}-card`);
    if(!button||!card)return;
    const rect=button.getBoundingClientRect();
    const width=Math.min(cardName==='speed'?324:310,window.innerWidth-24);style(card,'width',`${width}px`);
    const roomAbove=rect.top-21,roomBelow=window.innerHeight-rect.bottom-21;
    style(card,'overflow-y','auto');
    style(card,'left',`${Math.min(window.innerWidth-width-12,Math.max(12,rect.left+rect.width/2-width/2))}px`);
    // scrollHeight includes clipped content. Expanding maxHeight to measure it
    // on every poll used to reset scrollTop and then shrink the card again.
    const height=card.scrollHeight+card.offsetHeight-card.clientHeight;
    const useAbove=height<=roomAbove || roomAbove>=roomBelow;
    style(card,'max-height',`${Math.max(80,useAbove?roomAbove:roomBelow)}px`);
    style(card,'top',`${Math.max(12,useAbove?rect.top-card.offsetHeight-9:rect.bottom+9)}px`);
    attribute(card,'data-side',useAbove?'above':'below');
  }
  function positionGuide(){
    const tip=$('language-guide'),button=root?.querySelector('[data-card="context"]');
    if(!tip||tip.hidden||!button)return;
    const rect=button.getBoundingClientRect(),width=Math.min(244,innerWidth-24);
    style(tip,'width',`${width}px`);
    const left=Math.max(12,Math.min(innerWidth-width-12,rect.left+rect.width/2-width/2));
    style(tip,'left',`${left}px`);
    style(tip,'--guide-anchor',`${Math.max(16,Math.min(width-16,rect.left+rect.width/2-left))}px`);
    const above=rect.top-22,below=innerHeight-rect.bottom-22,height=tip.scrollHeight+tip.offsetHeight-tip.clientHeight,useAbove=height<=above||above>=below;
    style(tip,'max-height',`${Math.max(80,useAbove?above:below)}px`);
    style(tip,'top',`${Math.max(12,useAbove?rect.top-tip.offsetHeight-10:rect.bottom+10)}px`);
    attribute(tip,'data-side',useAbove?'above':'below');
  }
  function updateGuide(){
    const tip=$('language-guide');if(!tip)return;
    const visible=!disposed&&guideReady&&!guideDismissed&&!guideOpened&&!cardName&&!miniName&&node?.isConnected&&['main','ide'].includes(composer?.kind)&&node.dataset.layout==='ready'&&node.style.visibility!=='hidden';
    const entering=visible&&tip.hidden;
    const leaving=!visible&&!tip.hidden;
    const button=root.querySelector('[data-card="context"]');
    if(leaving)playExitGhost(tip,popoverFrames(tip,button,12,'close'),{duration:POPOVER_MS,easing:MOTION_EASE});
    cardVisibility(tip,visible);
    if(visible)button.setAttribute('aria-describedby','language-guide');else button.removeAttribute('aria-describedby');
    text('guide-save-note',guideError?'Could not save. Please retry. / 未能保存，请重试。':'');
    $('guide-close').disabled=guideSaving;
    positionGuide();
    if(entering&&!densityMedia.matches&&tip.animate)tip.animate(popoverFrames(tip,button,12,'open'),{duration:POPOVER_MS,easing:MOTION_EASE});
  }
  async function dismissGuide(){
    if(guideSaving)return;guideSaving=true;guideError=false;updateGuide();
    try{const value=await host().setPreferences({languageGuideDismissed:true});if(value?.languageGuideDismissed!==true||value.error)throw new Error('Guide not saved');syncGuide(value);preferences.sync(value);}
    catch{guideError=true;}
    finally{guideSaving=false;updateGuide();}
  }
  function findComposer(){
    if(surface)return surface.findComposer(composer);
    const visible=element=>element.isConnected&&!element.closest('[hidden],[inert]')&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden';
    const semanticEditors=Array.from(document.querySelectorAll('[role="combobox"][contenteditable="true"],[role="textbox"][contenteditable="true"]')).filter(visible);
    const editors=Array.from(new Set([...semanticEditors,...Array.from(document.querySelectorAll('[aria-label="Message input"]')).filter(visible)]));
    const stableModels=Array.from(document.querySelectorAll('[data-testid="model-selector-trigger"]')).filter(visible);
    const models=stableModels.length?stableModels:Array.from(document.querySelectorAll('button[role="combobox"][aria-haspopup],button[aria-label^="Select model"]')).filter(visible);
    const pairs=[];
    const ownsEditor=(element,editor)=>element.closest('[data-testid="agent-input-box"]')===editor.closest('[data-testid="agent-input-box"]');
    for(const model of models)for(const editor of editors){
      if(!ownsEditor(model,editor))continue;
      let row=model.parentElement,distance=1;
      // The toolbar branch and editable branch meet at their nearest common
      // composer ancestor. Action-button labels and generation state are irrelevant.
      while(row?.parentElement&&!row.parentElement.contains(editor)&&row.parentElement!==document.body&&row.parentElement!==document.documentElement){row=row.parentElement;distance++;}
      if(!row||row===document.body||row.contains(editor)||!row.parentElement?.contains(editor)||[document.body,document.documentElement].includes(row.parentElement))continue;
      for(let element=editor;element&&element!==row.parentElement;element=element.parentElement)distance++;
      let branch=model;while(branch.parentElement!==row)branch=branch.parentElement;
      const pair={editor,model,row,branch,box:editor.closest('[data-testid="agent-input-box"]'),distance,kind:'main'};
      if(composerLayout(pair))pairs.push(pair);
    }
    // Subagents have a static identity badge instead of a model selector.
    // Use only a bounded, stable host input box with a semantic send control;
    // never use the auxiliary pane's arbitrary comboboxes as an anchor.
    for(const editor of editors){
      const box=editor.closest('[data-testid="agent-input-box"]');
      if(!box||!visible(box))continue;
      const owned=e=>e.closest('[data-testid="agent-input-box"]')===box;
      const activeEditors=Array.from(box.querySelectorAll('[contenteditable="true"]')).filter(e=>owned(e)&&visible(e));
      if(!activeEditors.includes(editor)||activeEditors.length!==1)continue;
      if(Array.from(box.querySelectorAll('[data-testid="model-selector-trigger"]')).some(e=>owned(e)&&visible(e)))continue;
      const controls=Array.from(box.querySelectorAll('[data-testid="send-button"],[data-testid="send-button-loading"],[data-testid="send-button-pending"],[data-testid="input-cancel-button"],[data-tooltip-id*="send-button"],[data-testid="stop-button"],[data-testid="cancel-button"],button[aria-label]'))
        .filter(e=>owned(e)&&visible(e)&&(e.hasAttribute('data-testid')&&/^(?:(?:input-)?(?:send|stop|cancel)-button(?:-(?:loading|pending))?)$/.test(e.dataset.testid)||e.getAttribute('data-tooltip-id')?.includes('send-button')||/^(?:cancel|stop|取消|停止)(?:\b|\s|生成|任务|响应|$)/i.test(e.getAttribute('aria-label')||'')));
      for(const send of controls){
        let row=send.parentElement,distance=1;
        while(row?.parentElement&&row.parentElement!==box&&!row.parentElement.contains(editor)){row=row.parentElement;distance++;}
        if(!row||row.contains(editor)||!row.parentElement?.contains(editor)||!box.contains(row))continue;
        // The smallest static icon+text badge is structural evidence, even
        // without title/span. Icon-only controls and ambiguous badges fail closed.
        const interactive='button,a,input,select,[contenteditable="true"],[role="button"],[role="combobox"],[aria-haspopup]';
        const candidates=Array.from(row.querySelectorAll('*')).filter(e=>owned(e)&&visible(e)&&e.id!==ID&&!e.closest('#'+ID)&&e.querySelector('svg')&&badgeTextRects(e).length&&!e.contains(send)&&!send.contains(e)&&!e.matches(interactive)&&!e.closest(interactive)&&!e.querySelector(interactive));
        const anchors=candidates.filter(e=>!candidates.some(other=>other!==e&&e.contains(other)));
        if(anchors.length!==1)continue;
        const anchor=anchors[0];let branch=anchor;while(branch.parentElement!==row)branch=branch.parentElement;
        if(branch.contains(send))continue;
        for(let element=editor;element&&element!==row.parentElement;element=element.parentElement)distance++;
        const pair={editor,model:null,row,branch,anchor,box,distance,kind:'subagent'};
        if(composerLayout(pair)&&!pairs.some(p=>p.editor===editor&&p.row===row&&p.branch===branch))pairs.push(pair);
      }
    }
    pairs.sort((a,b)=>a.distance-b.distance);
    if(!pairs.length)return null;
    const focused=pairs.filter(pair=>pair.editor===document.activeElement||pair.editor.contains(document.activeElement));
    if(focused.length===1)return focused[0];
    const retained=pairs.filter(pair=>pair.branch===composer?.branch&&pair.editor===composer?.editor);
    if(retained.length===1)return retained[0];
    // Equally plausible visible composers must not place the strip arbitrarily.
    const closest=pairs.filter(pair=>pair.distance===pairs[0].distance);
    if(closest.length===1)return closest[0];
    const primary=closest.filter(pair=>!pair.box?.closest('[data-pane-unfocused],[data-side-panel-composer]'));
    if(primary.length===1&&primary.length<closest.length)return primary[0];
    return closest.find(pair=>pair.editor===document.activeElement)||closest.find(pair=>pair.branch===composer?.branch&&pair.editor===composer?.editor)||null;
  }
  function mount(){
    // Account usage does not belong to a composer lifecycle. Keep its frame
    // during reflows and park the host if the app replaces the input subtree.
    // Normal discovery reattaches the strip after the user closes the modal.
    if(usageDashboard?.isOpen&&node){
      if(!node.isConnected||!node.getClientRects().length){node.dataset.layout='blocked';document.body.append(node);usageDashboard.restoreModal();}
      return;
    }
    const found=findComposer();
    if(!found){
      stopDensityMotion();densityFrame=null;densityProbe=null;composer=null;resizeObserver?.disconnect();
      if(node){
        hide({immediate:true});usageDashboard?.dispose();usageDashboard=null;themeController?.dispose();themeController=null;
        node.remove();node=null;root=null;
        // A disposed dialog cannot be reused with its old strip/listeners.
        // Invalidate this mount's pending requests and rebuild on discovery.
        requestEpoch++;pending=false;refreshRequest=null;manualRequest=null;lastFetch=0;
      }
      return;
    }
    found.native=composer?.branch===found.branch&&composer?.anchor===found.anchor?composer.native:captureNative(found);
    if(found.kind==='ide')found.native.reserve=surface.nativeReserve(found);
    composer=found;
    if(syncConversation())render();
    const {editor,model,row,branch}=found;
    if(node)node.dataset.scope=found.kind;
    if(node?.isConnected&&node.parentElement===row&&node.previousElementSibling===branch)return;
    if(node){stopDensityMotion();densityFrame=null;densityProbe=null;hide({immediate:true});row.insertBefore(node,branch.nextSibling);observeComposer();themeController?.dispose();themeController=theme.attach(node,{embedded:true});if(data?.theme)themeController.setHostTheme(data.theme);fit();position();return;}
    resizeObserver?.disconnect();node?.remove();node=document.createElement('div');node.id=ID;
    node.dataset.scope=found.kind;
    node.style.cssText='display:flex;align-items:center;flex:0 1 auto;min-width:0;max-width:min(100%,var(--pulse-native-room,100%));height:28px;margin:0 5px;position:relative;';
    root=node.attachShadow({mode:'open'});
    setMarkup(root,`<style>${theme.shadowCss()}
      :host{color-scheme:var(--pulse-scheme);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--pulse-foreground);font-size:11px}*{box-sizing:border-box}button,select{font:inherit}button{cursor:pointer}svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round;flex:none}button:focus-visible,select:focus-visible{outline:2px solid var(--pulse-accent);outline-offset:2px}
      .bar{display:flex;justify-content:flex-start;width:100%;align-items:center;gap:7px;min-height:28px;padding:2px 0}.chip{display:flex;align-items:center;gap:6px;color:var(--pulse-chip);background:none;border:0;border-radius:5px;padding:3px 6px;white-space:nowrap;line-height:18px}.chip:hover,.chip[aria-expanded=true]{background:var(--pulse-hover);color:var(--pulse-hover-text)}.chip strong{font-weight:500;font-variant-numeric:tabular-nums}.dim{color:var(--pulse-muted)}.countdown{font-size:10px;font-variant-numeric:tabular-nums}.dot{width:4px;height:4px;background:var(--pulse-dot);border-radius:50%;flex:none}.dot.live{background:var(--pulse-success)}.dot.stale{background:var(--pulse-warning)}.group{color:var(--pulse-muted);font-size:10px;margin-right:1px}.card{position:fixed;inset:auto;margin:0;z-index:2147483000;padding:13px 14px 11px;border-radius:13px;background:linear-gradient(145deg,var(--pulse-card),var(--pulse-card-end));box-shadow:0 8px 32px var(--pulse-shadow);border:1px solid var(--pulse-border);color:var(--pulse-foreground);font-size:12px}.card::backdrop{background:transparent;pointer-events:none}.card[hidden]{display:none}dl>[hidden]{display:none}.heading{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;margin-bottom:9px;border-bottom:1px solid var(--pulse-separator);font-weight:600}.heading span{display:flex;align-items:center;gap:7px}.tag{font-size:10px;font-weight:400;color:var(--pulse-muted)}dl{margin:0}dl div{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:8px 0}dt{color:var(--pulse-label);font-size:11px}dd{margin:0;font-size:11px;font-variant-numeric:tabular-nums;text-align:right}.emphasis dd{font-weight:600;color:var(--pulse-emphasis)}.footnote{font-size:10px;color:var(--pulse-subtle);line-height:1.6;margin:10px 0 0}.footnote:empty{display:none}.balance{display:flex;align-items:baseline;gap:8px;margin:12px 0}.balance strong{font-size:27px;font-weight:550;letter-spacing:-.6px;font-variant-numeric:tabular-nums}.balance span{color:var(--pulse-muted);font-size:11px}.track{height:4px;border-radius:3px;background:var(--pulse-track);margin:12px 0 14px;overflow:hidden}.track i{height:100%;display:block;background:var(--pulse-accent);width:0}select{color:var(--pulse-control-text);background:var(--pulse-control);border:0;border-radius:4px;font-size:10px;padding:3px 5px;max-width:120px}.toolbar{display:flex;align-items:center;gap:7px}.refresh{color:var(--pulse-muted);border:0;background:transparent;padding:0 3px;font-size:14px}.reset{color:var(--pulse-emphasis)}.rounds,.group,.dot.live{display:none}.chip[hidden]{display:none}.toolbar{position:relative}.group-trigger{color:var(--pulse-control-text);background:var(--pulse-control);border:0;border-radius:5px;font-size:10px;padding:4px 7px;white-space:nowrap}.group-menu{position:absolute;top:calc(100% + 5px);right:22px;min-width:132px;padding:4px;background:var(--pulse-menu);border:1px solid var(--pulse-border);border-radius:7px;box-shadow:0 6px 20px var(--pulse-shadow);z-index:10}.group-menu[hidden]{display:none}.group-menu button{display:block;width:100%;padding:7px 9px;border:0;border-radius:4px;background:none;color:var(--pulse-foreground);text-align:left;white-space:nowrap}.group-menu button:hover,.group-menu button[aria-selected=true]{background:var(--pulse-selected)}.chip{padding:2px 4px;font-size:10px;gap:4px;min-width:0}.bar{gap:3px}.language-button{border:0;background:none;color:var(--pulse-muted);border-radius:4px;font-size:9px;padding:3px 4px;margin-left:auto;cursor:pointer;flex:none}.language-button:hover{color:var(--pulse-hover-text);background:var(--pulse-hover)}:host(.compact) .countdown{display:none}:host(.narrow) .cache-total{display:none}:host(.narrow) [data-card="cache"] .dim,:host(.narrow) [data-card="cache"] .chip-sep{display:none}.chip-sep{width:1px;height:10px;background:var(--pulse-separator);display:inline-block;flex:none}:host(.narrow) .chip svg{display:none}:host(.narrow) .chip{padding:2px 3px;font-size:9px}:host(.narrow) .bar{gap:0}

    :host([data-layout=blocked]){visibility:hidden!important;pointer-events:none!important}.bar{overflow:clip;min-width:0;max-width:100%}
    :host(.native-no-room){flex:0 0 0px!important;width:0!important;max-width:0!important;margin:0!important}
    .density-stage{position:absolute;overflow:clip;pointer-events:none;user-select:none}.density-piece{pointer-events:none!important}
    .scope-note{margin:0 0 10px;color:var(--pulse-muted);font-size:10px}:host([data-scope=main]) .scope-note,:host([data-scope=ide]) .scope-note{display:none}
    .language-button[data-save-failed=true]{color:var(--pulse-warning);text-decoration:underline dotted}.context-ring{display:inline-block;flex:none;width:12px;height:12px;border-radius:50%;background:conic-gradient(var(--pulse-ring) var(--used-angle,0deg),var(--pulse-ring-track) 0);mask:radial-gradient(circle,transparent 43%,#000 47%)}:host(.narrow) .context-label{display:none}
    #rate-note{white-space:pre-line;font-size:11px;line-height:1.65}
    .bar{gap:6px}.chip{font-size:11px;gap:5px;padding:3px 5px}.context-card>strong{font-size:16px}.context-card>p{margin:8px 0}.quota-heading{margin-top:14px;padding-top:12px;border-top:1px solid var(--pulse-separator)}.quota-title{display:flex;align-items:center;gap:6px;font-size:11px}.quota-title>span:first-child{display:flex;align-items:center;gap:6px;margin-right:auto;color:var(--pulse-label)}.quota-title strong{font-variant-numeric:tabular-nums;font-size:15px;font-weight:620;letter-spacing:-.02em;color:var(--pulse-foreground)}.quota-section+.quota-section{border-top:1px solid var(--pulse-separator);margin-top:12px;padding-top:12px}.quota-section .track{height:6px;border-radius:999px;margin:8px 0 9px}.quota-section .track i{border-radius:999px}.quota-section .footnote{margin-top:6px}.quota-section dl div{margin:6px 0}.quota-est-row dt,.quota-est-row dd{font-size:10.5px;color:var(--pulse-muted);font-weight:400}.context-label{white-space:nowrap}
    :host(.icons-only) .bar{gap:2px}:host(.icons-only) .chip{flex:0 0 24px;width:24px;min-width:24px;height:24px;padding:0;gap:0;justify-content:center}:host(.icons-only) .chip>:not(svg):not(.context-ring){display:none}:host(.icons-only) .bar>.language-button,:host(.icons-only) .bar>.dot{display:none}:host(.icons-only) .chip svg{display:block}.card-language{display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid var(--pulse-separator);font-size:10px;color:var(--pulse-muted)}
    .refresh{display:inline-grid;place-items:center}.refresh[aria-busy=true]{color:var(--pulse-emphasis);cursor:wait}.refresh[aria-busy=true] svg{animation:pulse-refresh-spin 1s linear infinite;transform-origin:center}
    @keyframes pulse-refresh-spin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){.refresh[aria-busy=true] svg{animation:none;opacity:.65}}
    </style><div class="bar" data-i18n-aria="strip" aria-label="Dashboard statistics">
      <span class="dot" id="dot" title="Connecting"></span>
      <button class="chip" data-card="speed" data-i18n-aria="session" hidden aria-controls="speed-card" aria-expanded="false">${svg('speed')}<span class="rounds dim" id="rounds"></span><strong id="tps">—</strong><span>tok/s</span></button>
      <button class="chip" data-card="cache" data-i18n-aria="cacheTitle" hidden aria-controls="cache-card" aria-expanded="false">${svg('cache')}<span class="cache-total" id="cache-total">—</span><i class="chip-sep" aria-hidden="true"></i><span data-i18n="cache">Cache hit</span><strong id="cache-rate">—</strong></button>
      <button class="chip" data-card="context" data-i18n-aria="context" hidden aria-controls="context-card" aria-expanded="false"><span class="context-ring" id="context-ring" aria-hidden="true"></span><span class="context-label" data-i18n="contextShort">Ctx</span><strong id="context-percent">—</strong></button>
    </div><div class="exit-stage" id="exit-stage" hidden></div><div class="mini-card" id="speed-mini" role="tooltip" hidden>
      <div class="mini-head"><strong id="mini-speed-tps">—</strong><span id="mini-speed-avg"></span></div>
      <div class="mini-sub" id="mini-speed-row"><i class="live-dot" aria-hidden="true"></i><span id="mini-speed-times">—</span></div>
    </div><div class="mini-card" id="cache-mini" role="tooltip" hidden>
      <div class="mini-head"><strong id="mini-cache-main">—</strong><span id="mini-cache-meta"></span></div>
      <div class="mini-sub"><span id="mini-cache-sub">—</span></div>
    </div><div class="mini-card context-mini" id="context-mini" role="tooltip" hidden>
      <div class="mini-head"><strong id="mini-ctx-pct">—</strong><span id="mini-ctx-tokens">—</span></div>
      <div class="mini-track"><i id="mini-ctx-fill"></i></div>
    </div><section class="card speed-card" id="speed-card" role="region" data-i18n-aria="session" aria-label="Session statistics" hidden>
      <div class="card-body" id="speed-card-body">
        <div class="heading">
          <span class="speed-head-left">${svg('speed')}<span data-i18n="session">Session</span><strong class="speed-hero" id="speed-hero-tps">—</strong><span class="speed-unit">tok/s</span></span>
          <div class="sample-pills" role="group" data-i18n-aria="tpsSampleRate" aria-label="Sample">${SAMPLE_OPTIONS.map(ms=>`<button type="button" class="sample-pill" data-sample-ms="${ms}" aria-pressed="${ms===sampleIntervalMs}">${ms<1000?`${ms/1000}s`:`${ms/1000}s`}</button>`).join('')}</div>
        </div>
        <div class="tps-chart-box" id="tps-chart-box">
          <div class="tps-chart-meta"><span id="tps-chart-peak">—</span><span id="tps-chart-hover" class="tps-hover-readout"></span><span id="tps-chart-avg-label">—</span></div>
          <svg class="tps-chart-svg" id="tps-chart-svg" viewBox="0 0 288 86" preserveAspectRatio="none" aria-hidden="true"></svg>
          <div class="tps-chart-empty" id="tps-chart-empty" data-i18n="tpsWaitingChart">${t('tpsWaitingChart')}</div>
        </div>
        <div class="speed-grid">
          <div class="metric-cell" id="model-time-cell"><span class="cell-label"><i class="live-dot" aria-hidden="true"></i><span data-i18n="modelTime">${t('modelTime')}</span></span><strong id="model-time">—</strong></div>
          <div class="metric-cell" id="tool-time-cell"><span class="cell-label"><i class="live-dot" aria-hidden="true"></i><span data-i18n="toolTime">${t('toolTime')}</span></span><strong id="tool-time">—</strong></div>
          <div class="metric-cell"><span class="cell-label" data-i18n="ttft">${t('ttft')}</span><strong id="ttft">—</strong></div>
          <div class="metric-cell"><span class="cell-label" data-i18n="tpsLastSession">${t('tpsLastSession')}</span><strong id="tps-last-avg">—</strong></div>
        </div>
        <p class="footnote" id="rate-note">${t('responseBasis')}</p>
      </div>
    </section><section class="card" id="cache-card" role="region" data-i18n-aria="cacheTitle" aria-label="Token cache" hidden>
      <div class="card-body" id="cache-card-body">
        <div class="heading"><span>${svg('cache')}<span data-i18n="cacheTitle">Token usage</span></span><span class="tag" id="samples">—</span></div>
        <dl>${[['cacheRate','cache-detail-rate'],['cacheMiss','cache-miss'],['cacheRead','cache-read'],['cacheOutput','cache-output'],['tokens','tokens'],['cacheWrite','cache-write']].map(([key,id])=>`<div ${id==='cache-write'?'id="cache-write-row" hidden':''}><dt data-i18n="${key}">${t(key)}</dt><dd id="${id}">—</dd></div>`).join('')}</dl><p class="footnote" id="cache-note">${t('cacheBasis')}</p>
      </div>
    </section><section class="card context-card" id="context-card" role="region" data-i18n-aria="context" hidden>
      <div class="card-body" id="context-card-body">
        <div class="heading"><span>${svg('context')}<span data-i18n="context">Context window</span></span><span class="tag" id="context-model">—</span></div>
        <div class="ctx-top"><strong id="context-summary">—</strong><span id="context-tokens">—</span></div>
        <div class="seg-track" role="progressbar" data-i18n-aria="context" id="context-track"><i id="context-fill"></i></div>
        <div class="ctx-breakdown" id="context-breakdown" hidden></div>
        <p class="footnote" id="context-note"></p>
        <div class="ide-quota-wrap" id="ide-quota-wrap"${surface?'':' hidden'}>
          <div class="heading quota-heading"><span data-i18n="group">Quota group</span><div class="toolbar"><button class="group-trigger" data-i18n-aria="group" aria-haspopup="listbox" aria-expanded="false">Quota ▾</button><div class="group-menu" role="listbox" data-i18n-aria="selectGroup" hidden></div><button class="refresh" data-i18n-aria="refresh" aria-label="Refresh quota" title="Refresh quota"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.8 6a5.1 5.1 0 1 0 .1 4M12.8 2.5V6H9.2"/></svg></button></div></div>
          <div class="quota-details">${['five','week'].map(name=>`<section class="quota-section" data-i18n-aria="${name}" aria-label="${t(name)}"><div class="quota-title"><span>${svg(name)}<span data-i18n="${name}">${t(name)}</span></span><strong id="${name}-balance">—</strong><span class="dim" data-i18n="remaining">remaining</span></div><div class="track" role="progressbar" data-i18n-aria="${name}" id="${name}-track"><i id="${name}-fill"></i></div><dl><div><dt data-i18n="resetIn">Resets in</dt><dd class="reset" id="${name}-countdown">—</dd></div><div><dt data-i18n="resetTime">Reset time (UTC+8)</dt><dd id="${name}-reset">—</dd></div><div class="quota-est-row" id="${name}-est-usd-row" hidden><dt data-i18n="estApiQuota">${t('estApiQuota')}</dt><dd id="${name}-est-usd">—</dd></div><div class="quota-est-row" id="${name}-est-tok-row" hidden><dt data-i18n="estRemaining">${t('estRemaining')}</dt><dd id="${name}-est-tok">—</dd></div></dl><p class="footnote" id="${name}-note">${t('loadingQuota')}</p></section>`).join('')}</div>
        </div>
      </div>
    </section>`);
    row.insertBefore(node,branch.nextSibling);
    for(const card of root.querySelectorAll('.card')){const note=document.createElement('p');note.className='scope-note';note.dataset.i18n='subagentStats';card.querySelector('.heading').after(note);}
    const languageRow=document.createElement('div');languageRow.className='card-language';
    setMarkup(languageRow,'<span>Language / 语言</span><div class="language-options" role="group" aria-label="Language / 语言"><button type="button" class="language-button" id="card-language-en" data-language-choice="en">English</button><button type="button" class="language-button" id="card-language-zh" data-language-choice="zh-CN">简体中文</button></div>');
    $('context-card-body').append(languageRow);
    const saveNote=document.createElement('p');saveNote.className='footnote';saveNote.id='language-save-note';languageRow.after(saveNote);
    const updateRow=document.createElement('div');updateRow.className='card-update';updateRow.id='update-row';updateRow.hidden=true;
    setMarkup(updateRow,'<span class="update-info" id="update-info"></span><div class="update-actions"><button type="button" class="update-btn" id="update-action"></button><button type="button" class="update-btn" id="update-auto" aria-pressed="true"></button></div>');
    saveNote.after(updateRow);
    const guide=document.createElement('section');guide.className='language-guide';guide.id='language-guide';guide.hidden=true;guide.setAttribute('role','region');guide.setAttribute('aria-label','Language / 语言');
    setMarkup(guide,'<div class="guide-heading"><strong>Language <span>/ 语言</span></strong><button type="button" id="guide-close" aria-label="Dismiss language tip / 关闭语言提示" title="Dismiss / 关闭">×</button></div><button type="button" id="guide-open"><span><span>Switch in context details</span><span lang="zh-CN">在上下文详情中切换语言</span></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8 4l4 4-4 4"/></svg></button><p class="footnote" id="guide-save-note"></p>');
    root.append(guide);
    const guideStyle=document.createElement('style');guideStyle.textContent=`
      .card-language{margin:10px 0 0;padding:8px 0 0;border-top:1px solid var(--pulse-separator);border-bottom:0;gap:8px;font-size:10px}
      .language-options{display:flex;gap:2px;padding:2px;border-radius:6px;background:var(--pulse-control);flex:none}
      .language-options .language-button{position:relative;isolation:isolate;font-size:10px;padding:3px 6px;margin:0;border-radius:4px;background:transparent;color:var(--pulse-muted);line-height:16px;transition:color 140ms ease}
      .language-options .language-button::before{content:'';position:absolute;inset:0;border-radius:inherit;background:var(--pulse-hover);opacity:0;transform:scale(.88);transition:transform 190ms cubic-bezier(.22,1,.36,1),opacity 140ms ease;z-index:-1;pointer-events:none}
      .language-options .language-button:hover{color:var(--pulse-foreground)}.language-options .language-button:hover::before{opacity:1;transform:scale(1)}
      .language-options .language-button[aria-pressed=true]{color:var(--pulse-foreground)}.language-options .language-button[aria-pressed=true]::before{opacity:1;transform:scale(1);box-shadow:0 1px 2px var(--pulse-shadow)}
      .language-options .language-button:active::before{transform:scale(.93);transition-duration:75ms}
      .language-guide{position:fixed;inset:auto;margin:0;padding:10px 12px;border:1px solid var(--pulse-border);border-radius:10px;background:var(--pulse-card);color:var(--pulse-foreground);box-shadow:0 4px 16px var(--pulse-shadow);font-size:11px;z-index:2147483000;overflow:visible}
      .language-guide[hidden]{display:none}.language-guide::backdrop{background:transparent;pointer-events:none}
      .language-guide::after{content:'';position:absolute;left:calc(var(--guide-anchor) - 4px);width:7px;height:7px;transform:rotate(45deg);background:var(--pulse-card);pointer-events:none}
      .language-guide[data-side=above]::after{bottom:-4px;border-right:1px solid var(--pulse-border);border-bottom:1px solid var(--pulse-border)}
      .language-guide[data-side=below]::after{top:-4px;border-left:1px solid var(--pulse-border);border-top:1px solid var(--pulse-border)}
      .guide-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:18px}
      .guide-heading strong{font-size:11px;font-weight:600}.guide-heading strong span{font-weight:400;color:var(--pulse-muted)}
      .language-guide button{position:relative;isolation:isolate;border:0;background:transparent;color:var(--pulse-muted);border-radius:4px;cursor:pointer;font:inherit;transition:color 140ms ease}
      .language-guide button::before{content:'';position:absolute;inset:0;border-radius:inherit;background:var(--pulse-hover);opacity:0;transform:scale(.92);transition:transform 180ms cubic-bezier(.22,1,.36,1),opacity 140ms ease;z-index:-1;pointer-events:none}
      .language-guide button:hover{color:var(--pulse-foreground)}.language-guide button:hover::before{opacity:1;transform:scale(1)}.language-guide button:active::before{transform:scale(.95);transition-duration:75ms}
      #guide-close{font-size:15px;line-height:18px;width:20px;height:20px;margin:-3px -4px -3px 0;padding:0}
      #guide-open{display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;width:calc(100% + 8px);margin:5px -4px -3px;padding:4px;line-height:16px}
      #guide-open>span{display:grid;gap:1px}#guide-open span[lang]{font-size:10px;color:var(--pulse-muted)}#guide-open svg{width:14px;height:14px;flex:none;transition:transform 180ms cubic-bezier(.22,1,.36,1)}#guide-open:hover svg{transform:translateX(2px)}
      #guide-save-note:empty,#language-save-note:empty{display:none}#guide-save-note,#language-save-note{color:var(--pulse-warning)}
      .card-update{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid var(--pulse-separator);font-size:10px;color:var(--pulse-muted)}.card-update[hidden]{display:none}
      .update-info{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}.update-info[data-state=available]{color:var(--pulse-accent);font-weight:500}.update-info[data-state=updated]{color:var(--pulse-success)}.update-info[data-state=error]{color:var(--pulse-warning)}
      .update-actions{display:flex;align-items:center;gap:4px;flex:none}
      .update-btn{position:relative;isolation:isolate;border:0;background:transparent;color:var(--pulse-muted);border-radius:4px;font-size:10px;padding:3px 6px;line-height:14px;cursor:pointer;transition:color 140ms ease}
      .update-btn::before{content:'';position:absolute;inset:0;border-radius:inherit;background:var(--pulse-control);transition:transform 190ms cubic-bezier(.22,1,.36,1),background-color 140ms ease;z-index:-1;pointer-events:none}
      .update-btn:hover:not(:disabled){color:var(--pulse-foreground)}.update-btn:hover:not(:disabled)::before{background:var(--pulse-hover);transform:scale(1.04)}
      .update-btn:active:not(:disabled)::before{transform:scale(.93);transition-duration:75ms}
      .update-btn:disabled{opacity:.6;cursor:wait}
      .update-btn[data-primary=true]{color:var(--pulse-accent);font-weight:500}.update-btn[data-primary=true]::before{background:color-mix(in srgb,var(--pulse-accent) 16%,transparent)}
      .update-btn[aria-pressed=true]{color:var(--pulse-foreground)}.update-btn[aria-pressed=true]::before{background:var(--pulse-hover)}
      .speed-head-left{display:flex;align-items:baseline;gap:5px;min-width:0}.speed-head-left svg{align-self:center}.speed-hero{font-size:15px;font-weight:600;letter-spacing:-.3px;font-variant-numeric:tabular-nums;color:var(--pulse-emphasis)}.speed-unit{font-size:9px;font-weight:400;color:var(--pulse-muted)}
      .sample-pills{display:flex;gap:2px;padding:2px;border-radius:6px;background:var(--pulse-control);flex:none}
      .sample-pill{position:relative;isolation:isolate;border:0;background:transparent;color:var(--pulse-muted);border-radius:4px;font-size:9px;font-weight:500;padding:2px 5px;line-height:14px;font-variant-numeric:tabular-nums;transition:color 130ms ease}
      .sample-pill::before{content:'';position:absolute;inset:0;border-radius:inherit;background:var(--pulse-hover);opacity:0;transform:scale(.86);transition:transform 190ms cubic-bezier(.22,1,.36,1),opacity 130ms ease;z-index:-1;pointer-events:none}
      .sample-pill:hover{color:var(--pulse-foreground)}.sample-pill:hover::before{opacity:.7;transform:scale(1)}
      .sample-pill[aria-pressed=true]{color:var(--pulse-foreground)}.sample-pill[aria-pressed=true]::before{opacity:1;transform:scale(1)}
      .sample-pill:active::before{transform:scale(.92);transition-duration:75ms}
      .tps-chart-box{position:relative;margin:2px 0 10px;padding:6px 8px 5px;border-radius:8px;background:var(--pulse-control);border:1px solid var(--pulse-separator)}
      .tps-chart-meta{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:9px;color:var(--pulse-muted);font-variant-numeric:tabular-nums;margin-bottom:4px;min-height:13px}
      .tps-hover-readout{color:var(--pulse-emphasis);font-weight:600}
      .tps-chart-svg{display:block;width:100%;height:86px;overflow:visible;cursor:crosshair}
      .tps-chart-empty{position:absolute;inset:20px 8px 6px;display:grid;place-items:center;font-size:10px;color:var(--pulse-muted);pointer-events:none}.tps-chart-empty[hidden]{display:none}
      .speed-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
      .metric-cell{display:flex;flex-direction:column;gap:3px;padding:7px 9px;border-radius:7px;background:var(--pulse-control);border:1px solid var(--pulse-separator);min-width:0}
      .cell-label{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--pulse-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .metric-cell strong{font-size:12px;font-weight:600;color:var(--pulse-foreground);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .live-dot{display:none;width:6px;height:6px;border-radius:50%;background:var(--pulse-success);flex:none}
      .metric-cell.live-active{border-color:color-mix(in srgb,var(--pulse-success) 45%,var(--pulse-separator))}
      .metric-cell.live-active .live-dot{display:inline-block;animation:pulse-live-dot 1.2s ease-in-out infinite}
      @keyframes pulse-live-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.75)}}
      .ctx-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:2px 0 8px}.ctx-top strong{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}.ctx-top span{font-size:11px;color:var(--pulse-label);font-variant-numeric:tabular-nums}
      .seg-track{display:flex;gap:1.5px;height:6px;border-radius:4px;background:var(--pulse-track);overflow:hidden;margin:0 0 10px}
      .seg-track>i{display:block;height:100%;min-width:2px;transition:width 180ms ease}
      .seg-track>i:first-child{border-radius:4px 0 0 4px}.seg-track>i:last-child{border-radius:0 4px 4px 0}.seg-track>i:only-child{border-radius:4px}
      .ctx-breakdown{display:flex;flex-direction:column;gap:5px;margin:2px 0 4px}.ctx-breakdown[hidden]{display:none}
      .ctx-row{display:grid;grid-template-columns:8px minmax(0,1fr) auto auto;align-items:center;gap:7px;font-size:11px;line-height:16px}
      .ctx-swatch{width:7px;height:7px;border-radius:2px;flex:none}
      .ctx-name{color:var(--pulse-label);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ctx-tok{color:var(--pulse-foreground);font-variant-numeric:tabular-nums;font-weight:500;text-align:right}
      .ctx-pct{color:var(--pulse-muted);font-size:10px;font-variant-numeric:tabular-nums;min-width:34px;text-align:right}
      .exit-stage{position:fixed;inset:0;margin:0;padding:0;border:0;width:100vw;height:100dvh;max-width:none;max-height:none;background:transparent;visibility:visible!important;pointer-events:none;z-index:2147483000;overflow:visible}
      .exit-stage[hidden]{display:none}.exit-stage::backdrop{background:transparent;pointer-events:none}
      .mini-card{position:fixed;inset:auto;margin:0;z-index:2147483000;padding:7px 10px 8px;border-radius:9px;background:color-mix(in srgb,var(--pulse-card) 86%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 4px 16px var(--pulse-shadow);border:1px solid var(--pulse-border);color:var(--pulse-foreground);font-size:11px;pointer-events:none}
      .mini-card[hidden]{display:none}.mini-card::backdrop{background:transparent;pointer-events:none}
      .mini-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px;font-variant-numeric:tabular-nums}.mini-head strong{font-size:12px;font-weight:600;white-space:nowrap}.mini-head span{font-size:10px;color:var(--pulse-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mini-sub{display:flex;align-items:center;gap:5px;font-size:10px;line-height:14px;color:var(--pulse-muted);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mini-sub.live-active{color:var(--pulse-label)}.mini-sub.live-active .live-dot{display:inline-block;width:5px;height:5px;animation:pulse-live-dot 1.2s ease-in-out infinite}
      .mini-track{height:4px;border-radius:3px;background:var(--pulse-track);overflow:hidden;margin-top:1px}.mini-track i{display:block;height:100%;width:0;border-radius:3px;background:var(--pulse-accent);transition:width 180ms cubic-bezier(.22,1,.36,1)}
      .card{background:linear-gradient(145deg,color-mix(in srgb,var(--pulse-card) 88%,transparent),color-mix(in srgb,var(--pulse-card-end) 88%,transparent));backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
      .chip{position:relative;isolation:isolate;background:transparent!important;transition:color 150ms ease}
      .chip::before{content:'';position:absolute;inset:0;border-radius:inherit;background:var(--pulse-hover);opacity:0;transform:scale(.88);transition:transform 210ms cubic-bezier(.22,1,.36,1),opacity 150ms ease;z-index:-1;pointer-events:none}
      .chip:hover,.chip[aria-expanded=true]{background:transparent!important;color:var(--pulse-hover-text)}
      .chip:hover::before,.chip[aria-expanded=true]::before{opacity:1;transform:scale(1)}
      .chip:active::before{transform:scale(.93);transition-duration:75ms}
      .chip svg,.chip .context-ring{transition:transform 210ms cubic-bezier(.22,1,.36,1)}
      .chip:hover svg,.chip:hover .context-ring{transform:scale(1.1)}
      .chip:active svg,.chip:active .context-ring{transform:scale(.9);transition-duration:75ms}
      .refresh svg{transition:transform 200ms cubic-bezier(.22,1,.36,1)}
      .refresh:hover:not([aria-busy=true]) svg{transform:scale(1.12)}
      .refresh:active:not([aria-busy=true]) svg{transform:scale(.9);transition-duration:75ms}
      .ide-quota-wrap[hidden]{display:none}
      @media(prefers-reduced-motion:reduce){.chip::before,.chip svg,.chip .context-ring,.sample-pill::before,.update-btn::before,.language-options .language-button::before,.language-guide button::before,#guide-open svg,.refresh svg{transition:none}}
    `;root.append(guideStyle);
    const runUpdateAction=async payload=>{
      if(!host()?.runUpdate)return;
      try{
        const next=await host().runUpdate(payload);
        if(next&&typeof next==='object'&&data){data.update=next;renderUpdateRow();}
      }catch{}
    };
    $('update-action').addEventListener('click',()=>{
      const u=data?.update;if(!u||u.status==='checking'||u.status==='updating')return;
      const action=u.updateAvailable&&u.hasAssets&&!u.devCheckout?'apply':'check';
      if(data.update)data.update={...u,status:action==='apply'?'updating':'checking'};
      renderUpdateRow();
      void runUpdateAction({action});
    });
    $('update-auto').addEventListener('click',()=>{
      const u=data?.update;if(!u)return;
      void runUpdateAction({action:'set-auto',autoUpdate:!u.autoUpdate});
    });
    $('guide-close').addEventListener('click',()=>void dismissGuide());
    $('guide-open').addEventListener('click',()=>{guideOpened=true;show('context',{pinned:true});$('card-language-zh').scrollIntoView({block:'nearest'});$('card-language-zh').focus({preventScroll:true});});
    // Escape ancestor stacking/paint contexts; ordinary z-index cannot do this.
    if(typeof HTMLElement.prototype.showPopover==='function'){
      for(const card of root.querySelectorAll('.card:not([data-exit-ghost]),.mini-card:not([data-exit-ghost])'))card.setAttribute('popover','manual');
      $('exit-stage')?.setAttribute('popover','manual');
    }
    if(typeof guide.showPopover==='function')guide.setAttribute('popover','manual');
    themeController=theme.attach(node,{embedded:true});
    report('mounted',{editorFound:true,composerFound:true});
    observeComposer();
    for(const pill of root.querySelectorAll('.sample-pill')){
      pill.addEventListener('click',()=>{
        const ms=Number(pill.dataset.sampleMs);
        if(!SAMPLE_OPTIONS.includes(ms))return;
        sampleIntervalMs=ms;
        localSet('ag-pulse-tps-interval',String(ms));
        for(const p of root.querySelectorAll('.sample-pill'))p.setAttribute('aria-pressed',String(Number(p.dataset.sampleMs)===ms));
        restartSampleTimer();
        renderTpsChart();
      });
    }
    const chartSvg=$('tps-chart-svg');
    if(chartSvg){
      chartSvg.addEventListener('pointermove',event=>{
        if(!tpsSeries.length)return;
        const rect=chartSvg.getBoundingClientRect();
        if(rect.width<=0)return;
        const ratio=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
        const idx=tpsSeries.length===1?0:Math.round(ratio*(tpsSeries.length-1));
        if(idx!==tpsChartHoverIdx){tpsChartHoverIdx=idx;renderTpsChart();}
      });
      chartSvg.addEventListener('pointerleave',()=>{
        if(tpsChartHoverIdx!==null){tpsChartHoverIdx=null;renderTpsChart();}
      });
    }
    for(const chip of root.querySelectorAll('[data-card]')){
      const name=chip.dataset.card;
      chip.addEventListener('pointerenter',()=>hoverChip(name));
      chip.addEventListener('pointerleave',()=>leaveChip(name));
      chip.addEventListener('focus',()=>{if(chip.matches(':focus-visible'))show(name,{pinned:false});});
      chip.addEventListener('click',()=>{
        if(cardName===name)hide();
        else{
          const mini=$(`${name}-mini`);
          const fromMini=Boolean(mini&&!mini.hidden);
          const morphFrom=(fromMini?mini:chip).getBoundingClientRect();
          show(name,{pinned:true,morphFrom,morphFromRadius:fromMini?9:6});
        }
      });
    }
    for(const card of root.querySelectorAll('.card')){
      card.addEventListener('pointerenter',()=>clearTimeout(hoverTimer));card.addEventListener('pointerleave',scheduleHide);
    }
    // A host composer may focus its editor on bubbled clicks. Keep plugin
    // controls' mouse actions inside the shadow root while retaining their
    // default focus/click behavior and document-level outside-click dismissal.
    for(const type of ['pointerdown','mousedown','click'])root.addEventListener(type,event=>event.stopPropagation());
    node.addEventListener('pointerenter',()=>clearTimeout(hoverTimer));node.addEventListener('pointerleave',scheduleHide);
    root.addEventListener('focusout',()=>setTimeout(()=>{if(!cardEngaged())hide();},0));
    for(const button of root.querySelectorAll('.group-trigger'))button.addEventListener('click',()=>{
      const menu=button.parentElement.querySelector('.group-menu');const opening=menu.hidden;closeGroup();if(opening){groupMenu=menu;menu.hidden=false;button.setAttribute('aria-expanded','true');}
    });
    for(const button of root.querySelectorAll('.refresh'))button.addEventListener('click',refreshManually);
    for(const button of root.querySelectorAll('[data-language-choice]'))button.addEventListener('click',()=>{closeGroup();void preferences.choose(button.dataset.languageChoice);});
    if(window.__agPulseUsageFactory){
      const section=document.createElement('div');section.id='usage-entry';section.hidden=true;
      setMarkup(section,'<dl class="usage-summary"><div><dt id="usage-today-label"></dt><dd><strong id="usage-today"></strong><span class="usage-unit">Token</span></dd></div><div><dt id="usage-month-label"></dt><dd><strong id="usage-month"></strong><span class="usage-unit">Token</span></dd></div></dl><button type="button" id="open-usage"><span id="usage-open-label"></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></button>');($('cache-card-body')||$('cache-card')).append(section);
      const css=document.createElement('style');css.textContent='#usage-entry{border-top:1px solid var(--pulse-separator);padding-top:13px;margin-top:14px}#usage-entry[hidden]{display:none}';root.append(css);
      css.textContent+=`
        .usage-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding-bottom:13px;border-bottom:1px solid var(--pulse-separator)}
        .usage-summary>div{display:block;min-width:0;margin:0}.usage-summary dt{font-size:10px;line-height:16px;color:var(--pulse-muted);margin:0 0 5px}.usage-summary dd{display:flex;align-items:baseline;justify-content:flex-start;gap:5px;margin:0;white-space:nowrap;text-align:left;line-height:24px}
        .usage-summary strong{font-size:20px;font-weight:550;letter-spacing:-.5px;color:var(--pulse-foreground);font-variant-numeric:tabular-nums}.usage-unit{font-size:9px;letter-spacing:0;color:var(--pulse-muted)}
        #open-usage{position:relative;isolation:isolate;display:flex;justify-content:space-between;align-items:center;min-height:34px;gap:12px;width:calc(100% + 12px);margin:5px -6px -3px;padding:7px 6px;border:0;border-radius:6px;background:transparent;color:var(--pulse-label);font:inherit;font-size:11px;text-align:left;line-height:20px;transition:color 140ms ease}
        #open-usage::before{content:'';position:absolute;inset:0;border-radius:inherit;background:var(--pulse-hover);opacity:0;transform:scale(.95);transition:transform 200ms cubic-bezier(.22,1,.36,1),opacity 140ms ease;z-index:-1;pointer-events:none}
        #open-usage:hover{color:var(--pulse-foreground)}#open-usage:hover::before{opacity:1;transform:scale(1)}#open-usage:active::before{transform:scale(.96);transition-duration:75ms}
        #open-usage svg{width:14px;height:14px;color:var(--pulse-muted);flex:none;transition:transform 200ms cubic-bezier(.22,1,.36,1),color 140ms ease}
        #open-usage:hover svg{transform:translateX(3px);color:var(--pulse-foreground)}
      `;
      usageDashboard=window.__agPulseUsageFactory({root,language,setMarkup,hostLabel:surface?.usageHostLabel||'Antigravity',guideDismissed:usageGuideDismissed,onDismissGuide:async()=>{const saved=await host().setPreferences({usageGuideDismissed:true});if(saved?.usageGuideDismissed!==true)throw Error('Usage guide could not be saved');syncGuide(saved);},onLanguage:next=>preferences.choose(next),onRefresh:()=>refreshManually(),onPricing:host()?.updatePricing?input=>host().updatePricing(input):null});
      const dissolveActiveCard=()=>{
        const active=cardName?$(`${cardName}-card`):null;
        if(active&&!active.hidden){
          const restSh=getComputedStyle(active).boxShadow;
          hide({immediate:true});
          playExitGhost(active,[
            {opacity:1,backdropFilter:'blur(16px)',webkitBackdropFilter:'blur(16px)',boxShadow:restSh},
            {opacity:0,backdropFilter:'blur(0px)',webkitBackdropFilter:'blur(0px)',boxShadow:zeroShadow(restSh)},
          ],{duration:POPOVER_MS,easing:MOTION_EASE});
        }else hide({immediate:true});
      };
      $('open-usage').addEventListener('click',()=>{
        const originRect=$('open-usage')?.getBoundingClientRect()||null;
        const trigger=root.querySelector('[data-card=cache]');
        dissolveActiveCard();
        usageDashboard.open(data?.usage,trigger,null,originRect);
      });
      const estEntry=document.createElement('div');estEntry.id='est-entry';estEntry.hidden=true;
      setMarkup(estEntry,'<button type="button" id="open-estimate"><span id="est-open-label"></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></button>');
      $('context-card').querySelector('.quota-details').after(estEntry);
      css.textContent+=`
        #est-entry{border-top:1px solid var(--pulse-separator);margin-top:10px;padding-top:6px}#est-entry[hidden]{display:none}
        #open-estimate{position:relative;isolation:isolate;width:calc(100% + 12px);display:flex;align-items:center;justify-content:space-between;min-height:30px;gap:12px;margin:0 -6px;padding:5px 6px;border:0;border-radius:6px;background:transparent;color:var(--pulse-label);font:inherit;font-size:11px;text-align:left;cursor:pointer;transition:color 140ms ease}
        #open-estimate::before{content:'';position:absolute;inset:0;border-radius:inherit;background:var(--pulse-hover);opacity:0;transform:scale(.95);transition:transform 200ms cubic-bezier(.22,1,.36,1),opacity 140ms ease;z-index:-1;pointer-events:none}
        #open-estimate:hover{color:var(--pulse-foreground)}#open-estimate:hover::before{opacity:1;transform:scale(1)}#open-estimate:active::before{transform:scale(.96);transition-duration:75ms}
        #open-estimate svg{width:14px;height:14px;color:var(--pulse-muted);flex:none;transition:transform 200ms cubic-bezier(.22,1,.36,1),color 140ms ease}
        #open-estimate:hover svg{transform:translateX(3px);color:var(--pulse-foreground)}
      `;
      $('open-estimate').addEventListener('click',()=>{
        const originRect=$('open-estimate')?.getBoundingClientRect()||null;
        const trigger=root.querySelector('[data-card=context]');
        dissolveActiveCard();
        usageDashboard.open(data?.usage,trigger,'estimate',originRect);
      });
    }
    localize();
    render();refresh();
  }
  function liveSecondsValue(base,startedAt){
    const startMs=startedAt?Date.parse(startedAt):NaN;
    const active=Number.isFinite(startMs);
    const extra=active?Math.max(0,(Date.now()-startMs)/1000):0;
    const total=typeof base==='number'&&Number.isFinite(base)?base+extra:(active?extra:null);
    return {total,active};
  }
  function shortElapsed(value){
    if(typeof value!=='number'||!Number.isFinite(value))return '—';
    const zh=language.language==='zh-CN';
    if(value<60)return `${value.toFixed(1)}${zh?'秒':'s'}`;
    const whole=Math.round(value),h=Math.floor(whole/3600),m=Math.floor(whole%3600/60),s=whole%60;
    if(h>0)return zh?`${h}小时${m}分`:`${h}h ${m}m`;
    return zh?`${m}分${s}秒`:`${m}m ${s}s`;
  }
  function updateLiveTiming(){
    if(!root)return;
    const speed=data?.speed;
    const lt=speed?.liveTiming;
    const running=Boolean(lt?.isRunning);
    const m=liveSecondsValue(speed?.modelSeconds,running?lt?.activeModelStartedAt:null);
    const tl=liveSecondsValue(speed?.toolSeconds,running?lt?.activeToolStartedAt:null);
    text('model-time',seconds(m.total));
    text('tool-time',seconds(tl.total));
    $('model-time-cell')?.classList.toggle('live-active',m.active);
    $('tool-time-cell')?.classList.toggle('live-active',tl.active);
    $('mini-speed-row')?.classList.toggle('live-active',m.active||tl.active);
    text('mini-speed-times',!speed&&!running?t('waitingRequest'):`${t('miniModel')} ${shortElapsed(m.total)} · ${t('miniTool')} ${shortElapsed(tl.total)}`);
  }
  function activeDomResponseBytes(){
    try{
      const view=document.querySelector('[data-testid="conversation-view"]')||document;
      const responses=view.querySelectorAll('[data-testid="agent-response"]');
      const last=responses.length?responses[responses.length-1]:null;
      return last?domUtf8Len(last.textContent||''):0;
    }catch{return 0;}
  }
  function effectiveAvgTps(speed){
    return typeof speed?.outputTps==='number'&&Number.isFinite(speed.outputTps)?speed.outputTps:(typeof speed?.tps==='number'&&Number.isFinite(speed.tps)?speed.tps:null);
  }
  function effectiveLatestTps(speed){
    return typeof speed?.latestOutputTps==='number'&&Number.isFinite(speed.latestOutputTps)?speed.latestOutputTps:(typeof speed?.latestTps==='number'&&Number.isFinite(speed.latestTps)?speed.latestTps:null);
  }
  function isModelActivelyGenerating(speed){
    const lt=speed?.liveTiming;
    return Boolean(lt?.isRunning&&(speed?.liveStream||(lt?.activeModelStartedAt&&!lt?.activeToolStartedAt)));
  }
  function resetStreamState(cid=null,reqs=-1){
    streamState={convo:cid,stepIdx:-1,baseBackendBytes:0,domBaseBytes:0,prevBytes:0,prevAt:0,liveTps:null,lastCompletedReqs:reqs};
  }
  function seedTpsSeries(speed){
    if(!speed)return;
    const cid=lastConversation||speed.conversationId||'';
    if(tpsSeriesConvo!==cid){
      tpsSeriesConvo=cid;
      resetStreamState(cid,typeof speed.requests==='number'?speed.requests:0);
      const hist=(speed.tpsHistory||[]).map(p=>p?.tps).filter(n=>typeof n==='number'&&Number.isFinite(n)&&n>0);
      if(hist.length)tpsSeries=hist.slice(-24);
      else{
        const initial=effectiveLatestTps(speed)??effectiveAvgTps(speed);
        tpsSeries=initial!==null?[initial]:[];
      }
    }else if(!tpsSeries.length){
      const initial=effectiveLatestTps(speed)??effectiveAvgTps(speed);
      if(initial!==null)tpsSeries=[initial];
    }
  }
  function syncCompletedTpsSample(speed){
    if(!speed)return;
    seedTpsSeries(speed);
    const reqs=typeof speed.requests==='number'?speed.requests:0;
    if(streamState.lastCompletedReqs<0){streamState.lastCompletedReqs=reqs;return;}
    if(reqs>streamState.lastCompletedReqs){
      streamState.lastCompletedReqs=reqs;
      streamState.liveTps=null;
      streamState.stepIdx=-1;
      const val=effectiveLatestTps(speed);
      if(val!==null){
        tpsSeries.push(Math.round(val*10)/10);
        if(tpsSeries.length>40)tpsSeries.shift();
      }
    }
  }
  function sampleLiveStreamingTps(){
    const speed=data?.speed;
    if(!speed)return;
    seedTpsSeries(speed);
    if(!isModelActivelyGenerating(speed)){
      if(streamState.liveTps!==null){
        streamState.liveTps=null;
        streamState.stepIdx=-1;
        renderLiveTpsReadouts();
      }
      return;
    }
    const now=Date.now();
    const ls=speed.liveStream;
    const stepIdx=ls?.stepIndex??(typeof speed.steps==='number'?speed.steps:0);
    const domBytes=activeDomResponseBytes();
    const backendBytes=typeof ls?.bytes==='number'?ls.bytes:0;
    if(streamState.stepIdx!==stepIdx){
      streamState.stepIdx=stepIdx;
      streamState.baseBackendBytes=backendBytes;
      streamState.domBaseBytes=domBytes;
      streamState.prevBytes=backendBytes;
      streamState.prevAt=now;
      const startMs=ls?.startedAt?Date.parse(ls.startedAt):NaN;
      if(backendBytes>0&&Number.isFinite(startMs)&&now-startMs>=250){
        streamState.liveTps=(backendBytes/3.7)/((now-startMs)/1000);
        tpsSeries.push(Math.round(streamState.liveTps*10)/10);
        if(tpsSeries.length>40)tpsSeries.shift();
      }
      renderLiveTpsReadouts();
      if(cardName==='speed')renderTpsChart();
      return;
    }
    if(backendBytes>streamState.baseBackendBytes){
      streamState.baseBackendBytes=backendBytes;
      streamState.domBaseBytes=domBytes;
    }
    const effectiveBytes=Math.max(backendBytes,streamState.baseBackendBytes+Math.max(0,domBytes-streamState.domBaseBytes));
    const dt=(now-streamState.prevAt)/1000;
    if(dt<0.2)return;
    const dBytes=Math.max(0,effectiveBytes-streamState.prevBytes);
    streamState.prevBytes=effectiveBytes;
    streamState.prevAt=now;
    if(dBytes>0){
      const inst=(dBytes/3.7)/dt;
      streamState.liveTps=streamState.liveTps!==null?streamState.liveTps*0.35+inst*0.65:inst;
      tpsSeries.push(Math.round(streamState.liveTps*10)/10);
      if(tpsSeries.length>40)tpsSeries.shift();
    }else if(streamState.liveTps!==null&&ls?.hasFirstToken){
      streamState.liveTps=streamState.liveTps*0.68;
      if(streamState.liveTps<0.5)streamState.liveTps=0;
      tpsSeries.push(Math.round(streamState.liveTps*10)/10);
      if(tpsSeries.length>40)tpsSeries.shift();
    }
    renderLiveTpsReadouts();
    if(cardName==='speed')renderTpsChart();
  }
  function renderLiveTpsReadouts(){
    if(!root||!data)return;
    const speed=data.speed;
    const avg=effectiveAvgTps(speed);
    const latest=effectiveLatestTps(speed);
    const live=isModelActivelyGenerating(speed)&&typeof streamState.liveTps==='number'&&Number.isFinite(streamState.liveTps)?streamState.liveTps:null;
    const heroVal=live!==null?live:(latest??avg);
    text('tps',rate(live!==null&&live>0?live:avg));
    text('speed-hero-tps',rate(heroVal));
    text('mini-speed-tps',typeof heroVal==='number'&&Number.isFinite(heroVal)?`${rate(heroVal)} tok/s`:'—');
    text('mini-speed-avg',typeof avg==='number'&&Number.isFinite(avg)?`${t('tpsAvg')} ${rate(avg)}`:'');
    const lastStr=live!==null?rate(live):typeof latest==='number'?rate(latest):speed?.latestRateStatus==='unreliable'?t('timingUnreliable'):speed?.latestRateStatus==='legacy'?t('ratePending'):rate(latest);
    const avgStr=speed?.latestRateStatus==='legacy'?t('ratePending'):rate(avg);
    text('tps-last-avg',`${lastStr} / ${avgStr}`);
  }
  function renderTpsChart(){
    if(!root)return;
    const svgEl=$('tps-chart-svg'),emptyEl=$('tps-chart-empty');
    if(!svgEl||!emptyEl)return;
    const speed=data?.speed;
    const avg=effectiveAvgTps(speed);
    const pts=tpsSeries;
    if(!pts.length){
      hidden(emptyEl,false);
      if(svgEl.childElementCount||svgEl.dataset.sig){svgEl.replaceChildren();delete svgEl.dataset.sig;}
      text('tps-chart-peak','—');
      text('tps-chart-avg-label',avg!==null?`${t('tpsAvg')} ${rate(avg)}`:'—');
      text('tps-chart-hover','');
      return;
    }
    hidden(emptyEl,true);
    const W=288,H=86,padT=8,padB=8,padL=2,padR=4;
    const plotW=W-padL-padR,plotH=H-padT-padB;
    const allVals=avg!==null?[...pts,avg]:pts;
    const rawMax=Math.max(...allVals,1);
    const maxV=Math.max(10,Math.ceil(rawMax*1.18/5)*5);
    const minV=0;
    const xAt=i=>pts.length===1?padL+plotW:padL+(i/(pts.length-1))*plotW;
    const yAt=v=>padT+plotH-((Math.max(minV,Math.min(maxV,v))-minV)/(maxV-minV))*plotH;
    const coords=pts.map((v,i)=>[xAt(i),yAt(v)]);
    const linePts=coords.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const areaPts=coords.length===1
      ? `${padL},${padT+plotH} ${padL},${coords[0][1].toFixed(1)} ${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)} ${coords[0][0].toFixed(1)},${padT+plotH}`
      : `${coords[0][0].toFixed(1)},${padT+plotH} ${linePts} ${coords.at(-1)[0].toFixed(1)},${padT+plotH}`;
    const midY=(padT+plotH/2).toFixed(1);
    const avgY=avg!==null?yAt(avg).toFixed(1):null;
    const last=coords.at(-1);
    const hoverIdx=tpsChartHoverIdx!==null&&tpsChartHoverIdx>=0&&tpsChartHoverIdx<pts.length?tpsChartHoverIdx:null;
    const hoverPt=hoverIdx!==null?coords[hoverIdx]:null;
    const peak=Math.max(...pts);
    text('tps-chart-peak',`${t('tpsPeak')} ${rate(peak)}`);
    text('tps-chart-avg-label',avg!==null?`${t('tpsAvg')} ${rate(avg)}`:'—');
    text('tps-chart-hover',hoverIdx!==null?`${rate(pts[hoverIdx])} tok/s`:'');
    const generating=isModelActivelyGenerating(speed);
    const chartMarkup=`<defs><linearGradient id="ag-tps-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--pulse-accent)" stop-opacity="0.28"/><stop offset="100%" stop-color="var(--pulse-accent)" stop-opacity="0.02"/></linearGradient></defs>`
      +`<line x1="${padL}" y1="${padT}" x2="${W-padR}" y2="${padT}" stroke="var(--pulse-separator)" stroke-width="0.8"/>`
      +`<line x1="${padL}" y1="${midY}" x2="${W-padR}" y2="${midY}" stroke="var(--pulse-separator)" stroke-width="0.8" stroke-dasharray="2 3"/>`
      +`<line x1="${padL}" y1="${padT+plotH}" x2="${W-padR}" y2="${padT+plotH}" stroke="var(--pulse-separator)" stroke-width="0.8"/>`
      +`<polygon points="${areaPts}" fill="url(#ag-tps-grad)"/>`
      +(avgY!==null?`<line x1="${padL}" y1="${avgY}" x2="${W-padR}" y2="${avgY}" stroke="var(--pulse-muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0.75"/>`:'')
      +(coords.length===1
        ? `<line x1="${padL}" y1="${last[1].toFixed(1)}" x2="${last[0].toFixed(1)}" y2="${last[1].toFixed(1)}" stroke="var(--pulse-accent)" stroke-width="1.8" stroke-linecap="round"/>`
        : `<polyline points="${linePts}" fill="none" stroke="var(--pulse-accent)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`)
      +(hoverPt?`<line x1="${hoverPt[0].toFixed(1)}" y1="${padT}" x2="${hoverPt[0].toFixed(1)}" y2="${padT+plotH}" stroke="var(--pulse-muted)" stroke-width="1" stroke-dasharray="2 2"/><circle cx="${hoverPt[0].toFixed(1)}" cy="${hoverPt[1].toFixed(1)}" r="3.4" fill="var(--pulse-accent)" stroke="var(--pulse-card)" stroke-width="1.4"/>`:'')
      +`<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="${generating?'3.4':'2.5'}" fill="var(--pulse-accent)" stroke="var(--pulse-card)" stroke-width="1.2"/>`;
    if(svgEl.dataset.sig!==chartMarkup){svgEl.dataset.sig=chartMarkup;setMarkup(svgEl,chartMarkup);}
  }
  function restartSampleTimer(){
    clearInterval(sampleTimerId);
    sampleTimerId=setInterval(()=>{
      if(disposed||!node?.isConnected)return;
      if(data?.speed&&isModelActivelyGenerating(data.speed)){
        sampleLiveStreamingTps();
      }
      if(!document.hidden&&data?.speed?.liveTiming?.isRunning&&Date.now()-lastFetch>=Math.max(450,sampleIntervalMs-50)){
        refresh();
      }
    },sampleIntervalMs);
  }
  function renderSegBar(container,context,fallbackEl){
    if(!container)return;
    const hasCapacity=typeof context?.usedFraction==='number';
    const items=context?.breakdown?.items;
    if(items?.length){
      const denom=context.maxTokens&&context.maxTokens>0?context.maxTokens:(context.breakdown.totalTokens||context.usedTokens||1);
      const scale=denom>0&&context.usedTokens>denom?denom/context.usedTokens:1;
      const html=items.map(item=>{
        const w=Math.max(0.8,Math.min(100,(item.tokens/denom)*100*scale));
        const col=CTX_COLORS[item.key]||CTX_COLORS.other;
        return `<i style="width:${w.toFixed(2)}%;background:${col}" title="${t(CTX_LABELS[item.key]||'ctxOther')}: ${count(item.tokens)}"></i>`;
      }).join('');
      if(container.dataset.sig!==html){container.dataset.sig=html;setMarkup(container,html);}
    }else if(fallbackEl){
      if(container.dataset.sig)delete container.dataset.sig;
      if(!fallbackEl.isConnected){container.replaceChildren(fallbackEl);}
      style(fallbackEl,'width',hasCapacity?`${Math.min(1,context.usedFraction)*100}%`:'0%');
      style(fallbackEl,'background',hasCapacity&&context.usedFraction>=.9?'var(--pulse-danger)':'var(--pulse-accent)');
    }else{
      const pctW=hasCapacity?Math.min(100,context.usedFraction*100):0;
      const col=hasCapacity&&context.usedFraction>=.9?'var(--pulse-danger)':'var(--pulse-accent)';
      const html=pctW>0?`<i style="width:${pctW.toFixed(2)}%;background:${col}"></i>`:'';
      if(container.dataset.sig!==html){container.dataset.sig=html;setMarkup(container,html);}
    }
  }
  function renderContextBreakdown(context){
    const hasCapacity=typeof context?.usedFraction==='number';
    text('mini-ctx-pct',hasCapacity?`${Math.round(context.usedFraction*100)}%`:'—');
    text('mini-ctx-tokens',context?`${compact(context.usedTokens)} / ${context.maxTokens===null?'—':compact(context.maxTokens)}`:'—');
    const miniFill=$('mini-ctx-fill');
    if(miniFill){
      style(miniFill,'width',hasCapacity?`${Math.min(1,context.usedFraction)*100}%`:'0%');
      style(miniFill,'background',hasCapacity&&context.usedFraction>=.9?'var(--pulse-danger)':'var(--pulse-accent)');
    }
    renderSegBar($('context-track'),context,$('context-fill'));
    const list=$('context-breakdown');
    if(!list)return;
    const items=context?.breakdown?.items;
    if(!items?.length){hidden(list,true);if(list.dataset.sig)delete list.dataset.sig;if(list.childElementCount)list.replaceChildren();return;}
    hidden(list,false);
    const denom=context.maxTokens&&context.maxTokens>0?context.maxTokens:(context.breakdown.totalTokens||context.usedTokens||1);
    const sig=items.map(i=>`${i.key}:${i.tokens}`).join('|')+'|'+denom+'|'+language.language;
    if(list.dataset.sig===sig&&list.childElementCount===items.length)return;
    list.dataset.sig=sig;
    list.replaceChildren(...items.map(item=>{
      const col=CTX_COLORS[item.key]||CTX_COLORS.other;
      const name=t(CTX_LABELS[item.key]||'ctxOther');
      const pctVal=denom>0?(item.tokens/denom)*100:0;
      const pctStr=pctVal>=10?`${Math.round(pctVal)}%`:pctVal>=0.1?`${pctVal.toFixed(1)}%`:'<0.1%';
      const rowEl=document.createElement('div');
      rowEl.className='ctx-row';
      rowEl.title=`${name}: ${count(item.tokens)}`;
      const sw=document.createElement('span');sw.className='ctx-swatch';sw.style.background=col;
      const nm=document.createElement('span');nm.className='ctx-name';nm.textContent=name;
      const tk=document.createElement('span');tk.className='ctx-tok';tk.textContent=compact(item.tokens);
      const pc=document.createElement('span');pc.className='ctx-pct';pc.textContent=pctStr;
      rowEl.append(sw,nm,tk,pc);
      return rowEl;
    }));
  }
  function ensureNativeUsageStyle(){
    if(nativeUsageStyle?.isConnected)return;
    nativeUsageStyle=document.getElementById(NATIVE_USAGE_STYLE_ID);
    if(!nativeUsageStyle){
      nativeUsageStyle=document.createElement('style');
      nativeUsageStyle.id=NATIVE_USAGE_STYLE_ID;
      nativeUsageStyle.textContent=`
        [data-ag-pulse-usage-popup="1"]{width:min(412px,calc(100vw - 24px))!important;max-height:min(460px,calc(100vh - 32px))!important;padding:10px 10px 8px!important;border-radius:12px!important;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
        [data-ag-pulse-usage-popup="1"]>div>div:first-child{padding:0 2px 7px!important;font-size:11px!important;line-height:14px!important;font-weight:600!important;letter-spacing:.02em;opacity:.75}
        [data-ag-pulse-usage-popup="1"] .custom-scrollbar{gap:10px!important}
        [data-ag-pulse-usage-popup="1"] [role="group"]:has([data-ag-pulse-has-est="1"]){display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px!important;align-items:stretch}
        [data-ag-pulse-usage-popup="1"] [role="group"]:has([data-ag-pulse-has-est="1"])>[role="presentation"]{grid-column:1 / -1;padding:0 2px 2px!important;font-size:12px!important;line-height:16px!important;font-weight:600!important}
        [data-ag-pulse-has-est="1"]{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;grid-template-rows:auto auto 1fr auto!important;align-items:start!important;gap:0 6px!important;padding:9px 11px 8px!important;border-radius:10px!important;background:var(--muted,rgba(128,128,128,.055))!important;border:1px solid var(--border,rgba(128,128,128,.12))!important;transition:background-color 150ms ease,border-color 150ms ease}
        [data-ag-pulse-has-est="1"]:nth-child(2):last-child{grid-column:1 / -1}
        [data-ag-pulse-has-est="1"]>:nth-child(1){grid-column:1;grid-row:1;align-self:baseline;font-size:11px!important;line-height:18px!important;font-weight:500!important;color:var(--muted-foreground,rgba(128,128,128,.9))!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        [data-ag-pulse-has-est="1"]>:nth-child(2){grid-column:2;grid-row:1;align-self:baseline;gap:0!important;font-variant-numeric:tabular-nums}
        [data-ag-pulse-has-est="1"]>:nth-child(2)>span:first-child{font-size:15px!important;line-height:19px!important;font-weight:660!important;letter-spacing:-.025em;color:var(--foreground,inherit)!important;opacity:1!important}
        [data-ag-pulse-has-est="1"][data-ag-pulse-quota-level="low"]>:nth-child(2)>span:first-child{color:#f59e0b!important}
        [data-ag-pulse-has-est="1"][data-ag-pulse-quota-level="critical"]>:nth-child(2)>span:first-child{color:#ef4444!important}
        [data-ag-pulse-has-est="1"]>:nth-child(2)>div{display:none!important}
        [data-ag-pulse-quota-ext="bar"]{grid-column:1 / -1;grid-row:2;margin-top:7px}
        [data-ag-pulse-quota-ext="bar"] .ag-rem-track{height:6px;width:100%;border-radius:999px;background:color-mix(in srgb,var(--foreground,#888) 14%,transparent);overflow:hidden}
        [data-ag-pulse-quota-ext="bar"] .ag-rem-track[data-empty="1"]{background:color-mix(in srgb,#ef4444 18%,transparent)}
        [data-ag-pulse-quota-ext="bar"] .ag-rem-fill{display:block;height:100%;width:0;border-radius:999px;background:#22c55e;transition:width 220ms cubic-bezier(.22,1,.36,1),background-color 180ms ease}
        [data-ag-pulse-quota-ext="bar"] .ag-rem-fill[data-level="low"]{background:#f59e0b}
        [data-ag-pulse-quota-ext="bar"] .ag-rem-fill[data-level="critical"]{background:#ef4444}
        [data-ag-pulse-has-est="1"]>.col-span-2{grid-column:1 / -1!important;grid-row:3!important;margin-top:5px!important;padding-top:0!important;border-top:0!important;font-size:10.5px!important;line-height:14px!important;color:var(--muted-foreground,rgba(128,128,128,.85))!important;opacity:.76;font-variant-numeric:tabular-nums}
        [data-ag-pulse-quota-ext="est"]{grid-column:1 / -1;grid-row:4;display:flex;align-items:baseline;justify-content:space-between;gap:6px;margin-top:8px;padding-top:6px;border-top:1px solid var(--border,rgba(128,128,128,.12));min-width:0;font-variant-numeric:tabular-nums}
        [data-ag-pulse-quota-ext="est"] .ag-est-usd{display:inline-flex;align-items:baseline;gap:3px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;line-height:15px}
        [data-ag-pulse-quota-ext="est"] .ag-est-rem{font-weight:550;color:color-mix(in srgb,var(--foreground,inherit) 76%,var(--muted-foreground,transparent))}
        [data-ag-pulse-quota-ext="est"] .ag-est-tot{font-size:10.5px;font-weight:400;color:var(--muted-foreground,rgba(128,128,128,.85));opacity:.78}
        [data-ag-pulse-quota-ext="est"] .ag-est-tok{font-size:10.5px;line-height:15px;color:var(--muted-foreground,rgba(128,128,128,.85));opacity:.78;white-space:nowrap;flex:none}
        [data-ag-pulse-quota-ext="est"] .ag-est-pending{font-size:10.5px;font-weight:450;line-height:15px;color:var(--muted-foreground,rgba(128,128,128,.85));opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        [data-ag-pulse-quota-ext="footer"]{position:relative;isolation:isolate;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;margin-top:9px;padding:10px 8px 6px;border:0;border-top:1px solid var(--border,rgba(128,128,128,.16));border-radius:0 0 7px 7px;background:transparent;color:var(--muted-foreground,inherit);font:inherit;font-size:12px;font-weight:500;cursor:pointer;transition:color 140ms ease}
        [data-ag-pulse-quota-ext="footer"]::before{content:'';position:absolute;inset:4px 0 0;border-radius:7px;background:var(--secondary,rgba(128,128,128,.1));opacity:0;transform:scale(.95);transition:transform 190ms cubic-bezier(.22,1,.36,1),opacity 140ms ease;z-index:-1;pointer-events:none}
        [data-ag-pulse-quota-ext="footer"]:hover{color:var(--foreground,inherit)}
        [data-ag-pulse-quota-ext="footer"]:hover::before{opacity:1;transform:scale(1)}
        [data-ag-pulse-quota-ext="footer"]:active::before{transform:scale(.96);transition-duration:75ms}
        [data-ag-pulse-quota-ext="footer"] svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;flex:none;opacity:.7;transition:transform 190ms cubic-bezier(.22,1,.36,1),opacity 140ms ease}
        [data-ag-pulse-quota-ext="footer"]:hover svg{transform:translateX(3px);opacity:1}
        @media(prefers-reduced-motion:reduce){[data-ag-pulse-usage-popup="1"],[data-ag-pulse-has-est="1"],[data-ag-pulse-quota-ext="bar"] .ag-rem-fill,[data-ag-pulse-quota-ext="footer"]::before,[data-ag-pulse-quota-ext="footer"] svg{transition:none}}
      `;
      (document.head||document.documentElement).append(nativeUsageStyle);
    }
  }
  const isUsageQuotaRow=g=>/%\s*left/i.test(g?.children?.[1]?.textContent||g?.textContent||'');
  function findNativeUsagePopup(){
    if(surface)return null;
    // Defensive cleanup: never allow quota extensions inside any menu with menuitems.
    for(const stray of document.querySelectorAll('[data-ag-pulse-quota-ext]')){
      const hostMenu=stray.closest('[role="menu"]');
      if(hostMenu&&hostMenu.querySelector('[role="menuitem"],[role="menuitemradio"]'))stray.remove();
    }
    const menus=document.querySelectorAll('[data-base-ui-portal] [role="menu"]');
    for(const popup of menus){
      if(!popup.isConnected)continue;
      const r=popup.getBoundingClientRect();
      const w=popup.offsetWidth||r.width,h=popup.offsetHeight||r.height;
      if(w<160||w>560||h<40||h>680)continue;
      // The Model menu has [role="menuitem"] / [role="menuitemradio"]; the Usage popup has ZERO.
      if(popup.querySelector('[role="menuitem"],[role="menuitemradio"],[data-testid="model-selector-trigger"]'))continue;
      const txt=(popup.textContent||'').trim();
      if(!txt||txt.length>1800||/\bView Usage\b/i.test(txt))continue;
      const rows=[...popup.querySelectorAll('div.grid')].filter(isUsageQuotaRow);
      const hasSignal=rows.length>0||Boolean(popup.querySelector('[data-testid="model-quota-refreshing"]'))||/No quota information available/i.test(txt);
      if(!hasSignal)continue;
      const inner=popup.querySelector('div.flex.flex-col.min-h-0.select-none')||[...popup.children].find(c=>c.classList?.contains('flex-col'))||popup;
      return {popup,inner};
    }
    return null;
  }
  function matchEstimateGroup(estGroups,groupTitle){
    if(!estGroups?.length)return null;
    const title=String(groupTitle||'');
    const hay=g=>`${g?.id||''} ${g?.name||''}`;
    if(/gemini/i.test(title))return estGroups.find(g=>/gemini/i.test(hay(g)))||null;
    if(/claude|gpt|3p|anthropic|openai/i.test(title))return estGroups.find(g=>/3p|claude|gpt|anthropic|openai/i.test(hay(g)))||null;
    return estGroups.find(g=>String(g.name||'').toLowerCase()===title.toLowerCase())||estGroups[0]||null;
  }
  function enhanceNativeUsagePopup(){
    if(disposed||surface||!data)return;
    const found=findNativeUsagePopup();
    if(!found)return;
    ensureNativeUsageStyle();
    const {popup,inner}=found;
    if(popup.getAttribute('data-ag-pulse-usage-popup')!=='1')popup.setAttribute('data-ag-pulse-usage-popup','1');
    const estGroups=data.quotaEstimate?.groups||[];
    const rows=[...inner.querySelectorAll('div.grid')].filter(isUsageQuotaRow);
    for(const row of rows){
      const firstText=(row.children[0]?.textContent||'').trim();
      const subText=(row.children[2]&&!row.children[2].hasAttribute('data-ag-pulse-quota-ext')?row.children[2].textContent:'').trim();
      const groupContainer=row.closest('[role="group"]')||row.parentElement;
      const parentFirst=groupContainer?.firstElementChild;
      const groupTitle=(parentFirst&&parentFirst!==row&&!parentFirst.classList.contains('grid')&&!parentFirst.contains(row))?(parentFirst.textContent||'').trim():firstText;
      const estGroup=matchEstimateGroup(estGroups,groupTitle);
      const matchWin=s=>/\b5\s*-?\s*h(?:our)?\b/i.test(s)?'5h':/\b(?:week(?:ly)?|7\s*-?\s*d(?:ay)?)\b/i.test(s)?'weekly':null;
      const winKey=matchWin(firstText)||matchWin(subText);
      const w=winKey?estGroup?.windows?.[winKey]:null;
      let barWrap=row.querySelector('[data-ag-pulse-quota-ext="bar"]');
      let badge=row.querySelector('[data-ag-pulse-quota-ext="est"]');
      if(!w?.available){
        if(barWrap)barWrap.remove();
        if(badge)badge.remove();
        row.removeAttribute('data-ag-pulse-has-est');
        row.removeAttribute('data-ag-pulse-quota-level');
        continue;
      }
      let remFrac=typeof w.remaining==='number'&&Number.isFinite(w.remaining)?Math.max(0,Math.min(1,w.remaining)):null;
      if(remFrac===null){
        const pm=(row.children[1]?.textContent||'').match(/(\d+(?:\.\d+)?)\s*%/);
        if(pm)remFrac=Math.max(0,Math.min(1,Number(pm[1])/100));
      }
      const level=remFrac!==null?(remFrac<0.05?'critical':remFrac<0.2?'low':'ok'):'ok';
      if(row.getAttribute('data-ag-pulse-quota-level')!==level)row.setAttribute('data-ag-pulse-quota-level',level);
      if(!barWrap){
        barWrap=document.createElement('div');
        barWrap.setAttribute('data-ag-pulse-quota-ext','bar');
        const track=document.createElement('div');track.className='ag-rem-track';
        const fill=document.createElement('i');fill.className='ag-rem-fill';
        track.append(fill);barWrap.append(track);
        row.append(barWrap);
      }
      const barSig=`${remFrac===null?'':Math.round(remFrac*1000)}|${level}`;
      if(barWrap.dataset.sig!==barSig){
        barWrap.dataset.sig=barSig;
        const track=barWrap.firstElementChild,fill=track?.firstElementChild;
        if(track&&fill){
          if(remFrac===0)track.setAttribute('data-empty','1');else track.removeAttribute('data-empty');
          fill.setAttribute('data-level',level);
          fill.style.width=remFrac===null?'0%':`${(remFrac*100).toFixed(1)}%`;
          fill.style.minWidth=remFrac!==null&&remFrac>0?'4px':'0';
        }
      }
      if(!badge){
        badge=document.createElement('div');
        badge.setAttribute('data-ag-pulse-quota-ext','est');
        row.append(badge);
      }
      if(row.getAttribute('data-ag-pulse-has-est')!=='1')row.setAttribute('data-ag-pulse-has-est','1');
      let remUsd='',totUsd='',tokStr='',titleStr='',isPending=false;
      if(w.calibrated){
        if(w.totalQuotaUsd!=null){
          remUsd=`~${fmtShortUsd(w.remainingQuotaUsd)}`;
          totUsd=`/ ${fmtShortUsd(w.totalQuotaUsd)}`;
        }
        const tok=w.estimatedRemainingTokens,totTok=w.estimatedTotalTokens;
        tokStr=tok==null?'':tok===0?'0 tok':`${compact(tok)} tok`;
        const prior=w.calibrationSource==='prior-window'?` (${t('estPrior')})`:'';
        const usdTip=w.totalQuotaUsd!=null?`~${fmtUsd(w.remainingQuotaUsd)} / ~${fmtUsd(w.totalQuotaUsd)}`:'';
        const tokTip=tok!=null?`${count(tok)}${totTok!=null?' / '+count(totTok):''} tok`:'';
        titleStr=[usdTip,tokTip].filter(Boolean).join(' · ')+prior;
      }else{
        isPending=true;
        titleStr=`${t('estWaiting')} · ${t('estWaitingSub')}`;
      }
      const sig=`${isPending?1:0}|${remUsd}|${totUsd}|${tokStr}|${language.language}`;
      if(badge.dataset.sig!==sig){
        badge.dataset.sig=sig;
        badge.replaceChildren();
        if(isPending){
          const p=document.createElement('span');p.className='ag-est-pending';p.textContent=t('estWaiting');
          badge.append(p);
        }else if(remUsd){
          const usd=document.createElement('span');usd.className='ag-est-usd';
          const rem=document.createElement('span');rem.className='ag-est-rem';rem.textContent=remUsd;
          const tot=document.createElement('span');tot.className='ag-est-tot';tot.textContent=totUsd;
          usd.append(rem,tot);
          badge.append(usd);
          if(tokStr){
            const tk=document.createElement('span');tk.className='ag-est-tok';tk.textContent=tokStr;
            badge.append(tk);
          }
        }else if(tokStr){
          const usd=document.createElement('span');usd.className='ag-est-usd';
          const rem=document.createElement('span');rem.className='ag-est-rem';rem.textContent=`~${tokStr}`;
          usd.append(rem);
          badge.append(usd);
        }
      }
      if(badge.title!==titleStr)badge.title=titleStr;
    }
    let footer=inner.querySelector('[data-ag-pulse-quota-ext="footer"]');
    if(usageDashboard&&data.usage){
      if(!footer){
        footer=document.createElement('button');
        footer.type='button';
        footer.setAttribute('data-ag-pulse-quota-ext','footer');
        footer.addEventListener('pointerdown',e=>e.stopPropagation());
        footer.addEventListener('click',e=>{
          e.stopPropagation();
          const originRect=footer.getBoundingClientRect();
          const resolveTrigger=()=>document.querySelector('[data-testid="model-selector-trigger"]')||root?.querySelector('[data-card="context"]')||null;
          const escInit={key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true};
          popup.dispatchEvent(new KeyboardEvent('keydown',escInit));
          document.activeElement?.dispatchEvent?.(new KeyboardEvent('keydown',escInit));
          usageDashboard?.open(data?.usage,resolveTrigger,'estimate',originRect);
        });
        inner.append(footer);
      }
      const labelTxt=t('estCalibrationBtn');
      if(footer.dataset.label!==labelTxt){
        footer.dataset.label=labelTxt;
        const lbl=document.createElement('span');lbl.textContent=labelTxt;
        const ns='http://www.w3.org/2000/svg';
        const svgNode=document.createElementNS(ns,'svg');
        svgNode.setAttribute('viewBox','0 0 16 16');svgNode.setAttribute('aria-hidden','true');
        const pathNode=document.createElementNS(ns,'path');
        pathNode.setAttribute('d','M3 8h10M9 4l4 4-4 4');
        svgNode.append(pathNode);
        footer.replaceChildren(lbl,svgNode);
      }
    }else if(footer){
      footer.remove();
    }
  }
  function renderNativeUsagePanel(){enhanceNativeUsagePopup();}
  function syncNativeUsagePanel(){enhanceNativeUsagePopup();}
  function scheduleNativeUsageSync(){
    if(surface||nativeUsageFrame!==null)return;
    nativeUsageFrame=requestAnimationFrame(()=>{nativeUsageFrame=null;enhanceNativeUsagePopup();});
  }
  function disposeNativeUsagePanel(){
    if(nativeUsageFrame!==null){cancelAnimationFrame(nativeUsageFrame);nativeUsageFrame=null;}
    for(const el of document.querySelectorAll('[data-ag-pulse-quota-ext]'))el.remove();
    for(const el of document.querySelectorAll('[data-ag-pulse-usage-popup]'))el.removeAttribute('data-ag-pulse-usage-popup');
    for(const el of document.querySelectorAll('[data-ag-pulse-has-est]'))el.removeAttribute('data-ag-pulse-has-est');
    for(const el of document.querySelectorAll('[data-ag-pulse-quota-level]'))el.removeAttribute('data-ag-pulse-quota-level');
    nativeUsageStyle?.remove();nativeUsageStyle=null;
  }
  function render(){
    if(!root||!data)return;
    syncConversation();
    if(usageDashboard){
      const available=Boolean(data.usage);hidden($('usage-entry'),!available);
      if($('est-entry'))hidden($('est-entry'),!surface||!available||!(data.quotaEstimate?.groups?.length));
      text('usage-today',compact(data.usage?.todayTokens));text('usage-month',compact(data.usage?.monthTokens));usageDashboard.update(data.usage);
    }
    if(groupMenu)return;
    const groups=data.groups||[],model=composer?.model?.getAttribute('aria-label')||composer?.model?.textContent||data.speed?.model||'';
    group=groups.find(g=>g.id===chosen)||groups.find(g=>/gemini/i.test(model)?/gemini/i.test(g.id):/claude|gpt/i.test(model)?/3p|claude|gpt/i.test(g.id):false)||groups[0];
    for(const button of root.querySelectorAll('.group-trigger')){
      if(button.textContent!==`${label(group)} ▾`)button.textContent=`${label(group)} ▾`;
      const menu=button.parentElement.querySelector('.group-menu'),signature=groups.map(g=>g.id).join('|');
      if(menu.dataset.signature!==signature){menu.replaceChildren(...groups.map(g=>{const option=document.createElement('button');option.type='button';option.setAttribute('role','option');option.textContent=label(g);option.dataset.group=g.id;option.addEventListener('click',()=>{chosen=g.id;localSet('ag-pulse-group',chosen);closeGroup();render();menu.parentElement.querySelector('.group-trigger')?.focus({preventScroll:true});});return option;}));menu.dataset.signature=signature;}
      for(const option of menu.children)attribute(option,'aria-selected',option.dataset.group===group?.id);
    }
    const speed=data.speed;
    hidden(root.querySelector('[data-card="speed"]'),!lastConversation&&!surface?.showEmpty);
    hidden(root.querySelector('[data-card="cache"]'),!lastConversation&&!surface?.showEmpty&&!data.usage);
    const context=speed?.context, hasCapacity=typeof context?.usedFraction==='number';
    hidden(root.querySelector('[data-card="context"]'),false);
    const empty=surface?.conversationState?.(composer).status==='new'&&!lastConversation&&data.connection==='live';
    text('context-percent',hasCapacity?`${Math.round(context.usedFraction*100)}%`:'—');
    style($('context-ring'),'--used-angle',`${hasCapacity?Math.min(1,context.usedFraction)*360:0}deg`);
    text('context-summary',hasCapacity?t('contextUsed',{used:Math.round(context.usedFraction*100),remaining:Math.round(context.remainingFraction*100)}):t(empty?'waitingRequest':'contextUnknown'));
    text('context-tokens',context?t('contextTokens',{used:compact(context.usedTokens),max:context.maxTokens===null?'—':compact(context.maxTokens)}):'—');
    text('context-model',context?.model||'—');
    const restored=context&&(speed.contextRestored===true||speed.restoredFromHistory&&speed.contextRestored!==false);
    text('context-note',[context?t('contextBasis'):t(empty?'newConversationStats':'contextUnavailable'),restored?t('contextSaved',{time:speed.savedAt?language.resetDate(speed.savedAt):'—'}):'',hasCapacity&&context.usedFraction>1?t('contextExceeded'):''].filter(Boolean).join(' '));
    renderContextBreakdown(context);
    attribute($('context-track'),'aria-valuenow',hasCapacity?Math.min(100,context.usedFraction*100):null);attribute($('context-track'),'aria-valuemin','0');attribute($('context-track'),'aria-valuemax','100');
    text('rounds',speed?t('rounds',{rounds:speed.rounds,steps:speed.steps}):'');
    text('samples',speed?(language.language==='zh-CN'?`${speed.rounds}轮 ${speed.steps}步 (${speed.measuredRequests}次)`:`${speed.rounds} turns, ${speed.steps} steps (${speed.measuredRequests})`):t('waitingRequest'));
    text('ttft',seconds(speed?.ttftSeconds));
    text('tokens',speed?`${count(speed.counts.responseOutput)} / ${count(speed.counts.thinkingOutput)}`:'—');
    syncCompletedTpsSample(speed);
    if(isModelActivelyGenerating(speed))sampleLiveStreamingTps();
    renderLiveTpsReadouts();
    renderTpsChart();
    updateLiveTiming();
    const savedNote=speed?.restoredFromHistory?' '+t('savedStats',{time:speed.savedAt?language.resetDate(speed.savedAt):'—'}):'';
    const saveWarning=data.persistenceError?' '+t('saveFailed'):'';
    const basisNote=speed&&speed.counts?.thinkingOutput>0?t('allBasis'):language.rateNote(speed);
    text('rate-note',[language.errorMessage(data.error||data.sessionError),basisNote].filter(Boolean).join(' ')+savedNote+saveWarning);
    const cache=speed?.cache;
    text('cache-rate',pct(cache?.hitRate));text('cache-detail-rate',pct(cache?.hitRate));
    text('cache-total',cache?.measuredRequests?compact(cache.totalTokens):'—');
    for(const [field,id]of[['cachedTokens','cache-read'],['uncachedTokens','cache-miss'],['cacheWriteTokens','cache-write'],['outputTokens','cache-output']])text(id,cache?.measuredRequests?`${count(cache[field])} tok`:'—');
    hidden($('cache-write-row'),!(cache?.cacheWriteTokens>0));
    if(cache?.measuredRequests){
      text('mini-cache-main',compact(cache.totalTokens));
      text('mini-cache-meta',`${t('miniHit')} ${pct(cache.hitRate)}`);
      text('mini-cache-sub',data.usage?`${t('miniToday')} ${compact(data.usage.todayTokens)} · ${t('miniMonth')} ${compact(data.usage.monthTokens)}`:`${t('miniRead')} ${compact(cache.cachedTokens)} · ${t('miniOut')} ${compact(cache.outputTokens)}`);
    }else if(data.usage){
      text('mini-cache-main',compact(data.usage.todayTokens));
      text('mini-cache-meta',t('miniToday'));
      text('mini-cache-sub',`${t('miniMonth')} ${compact(data.usage.monthTokens)} · ${t('miniTotal')} ${compact(data.usage.totalTokens)}`);
    }else{
      text('mini-cache-main','—');
      text('mini-cache-meta','');
      text('mini-cache-sub',t(empty?'newConversationStats':'cacheUnavailable'));
    }
    text('cache-note',[cache?.measuredRequests?t('cacheBasis'):t(empty?'newConversationStats':'cacheUnavailable'),cache?.measuredRequests&&cache.missingRequests?t('cacheMissing',{n:cache.missingRequests}):'',savedNote.trim(),saveWarning.trim()].filter(Boolean).join(' '));
    const estGroup=(data.quotaEstimate?.groups||[]).find(g=>g.id===group?.id)||null;
    for(const [window,name]of[['5h','five'],['weekly','week']]){
      const b=group?.windows?.[window];text(name,pct(b?.remaining));text(`${name}-balance`,pct(b?.remaining));text(`${name}-reset`,date(b?.resetAt));
      style($(`${name}-fill`),'width',typeof b?.remaining==='number'?`${b.remaining*100}%`:'0%');style($(`${name}-fill`),'background',b?.remaining<.05?'var(--pulse-danger)':b?.remaining<.2?'var(--pulse-warning)':'');
      attribute($(`${name}-track`),'aria-valuenow',typeof b?.remaining==='number'?b.remaining*100:null);attribute($(`${name}-track`),'aria-valuemin','0');attribute($(`${name}-track`),'aria-valuemax','100');
      const estW=estGroup?.windows?.[window];
      if(estW?.available&&estW.calibrated){
        hidden($(`${name}-est-usd-row`),estW.totalQuotaUsd==null);
        if(estW.totalQuotaUsd!=null)text(`${name}-est-usd`,`~${fmtUsd(estW.remainingQuotaUsd)} / ~${fmtUsd(estW.totalQuotaUsd)}`);
        hidden($(`${name}-est-tok-row`),false);
        const tok=estW.estimatedRemainingTokens,totTok=estW.estimatedTotalTokens;
        text(`${name}-est-tok`,tok==null?'—':tok===0?(totTok!=null?`0 / ~${compact(totTok)}`:'0'):(totTok!=null?`~${compact(tok)} / ~${compact(totTok)}`:`~${compact(tok)}`));
        const tokEl=$(`${name}-est-tok`);
        if(tokEl)tokEl.title=tok!=null?`${count(tok)}${totTok!=null?' / '+count(totTok):''} tok${estW.calibrationSource==='prior-window'?' ('+t('estPrior')+')':''}`:'';
      }else if(estW?.available){
        hidden($(`${name}-est-usd-row`),true);
        hidden($(`${name}-est-tok-row`),false);
        text(`${name}-est-tok`,t('estWaiting'));
      }else{
        hidden($(`${name}-est-usd-row`),true);hidden($(`${name}-est-tok-row`),true);
      }
      const errNote=language.errorMessage(data.error)||(b?.disabled?t('disabledQuota'):!b?.available?t('noQuota'):'');
      const updNote=window==='weekly'&&!errNote&&data.quotaUpdatedAt?t('updated',{time:new Date(data.quotaUpdatedAt).toLocaleTimeString(language.language,{hour12:false})}):'';
      text(`${name}-note`,[composer?.kind==='subagent'&&window==='5h'?t('accountQuota'):'',errNote,updNote].filter(Boolean).join(' — '));
    }
    attribute($('dot'),'class',`dot ${data.connection}`);attribute($('dot'),'title',t(data.connection==='live'?'live':data.connection==='stale'?'stale':'offline'));renderUpdateRow();renderNativeUsagePanel();tick();fit();position();
  }
  function renderUpdateRow(){
    const row=$('update-row');if(!row)return;
    const u=data?.update;
    const visible=Boolean(u&&host()?.runUpdate);
    hidden(row,!visible);
    if(!visible)return;
    const info=$('update-info'),actionBtn=$('update-action'),autoBtn=$('update-auto');
    const ver=`v${u.currentVersion||'0.0.0'}`;
    let statusText='';
    if(u.status==='updating')statusText=t('updateUpdating');
    else if(u.status==='checking')statusText=t('updateChecking');
    else if(u.status==='updated')statusText=t('updateApplied',{version:u.lastUpdatedVersion||u.latestVersion||u.currentVersion});
    else if(u.updateAvailable&&u.latestVersion)statusText=t('updateAvailable',{version:u.latestVersion});
    else if(u.status==='error')statusText=t('updateFailed');
    else if(u.status==='up-to-date')statusText=t('updateLatest');
    else if(u.devCheckout)statusText=t('updateDev');
    info.textContent=statusText?`${ver} (${statusText})`:ver;
    info.dataset.state=u.status||'idle';
    info.title=u.error||u.releaseUrl||'';
    const busy=u.status==='checking'||u.status==='updating';
    const canApply=Boolean(u.updateAvailable&&u.hasAssets&&!u.devCheckout);
    actionBtn.disabled=busy;
    actionBtn.dataset.primary=String(canApply&&!busy);
    actionBtn.textContent=u.status==='updating'?t('updateUpdating'):u.status==='checking'?t('updateChecking'):canApply?t('updateNow'):t('updateCheck');
    autoBtn.textContent=t('updateAuto');
    autoBtn.setAttribute('aria-pressed',String(Boolean(u.autoUpdate)));
    hidden(autoBtn,Boolean(u.devCheckout));
  }
  function tick(){
    if(!root)return;
    updateLiveTiming();
    for(const [window,name]of[['5h','five'],['weekly','week']]){const b=group?.windows?.[window];text(`${name}-timer`,timer(b?.resetAt,true));text(`${name}-countdown`,timer(b?.resetAt));if(b?.resetAt&&Date.parse(b.resetAt)<=Date.now()&&Date.now()-lastExpiredRefresh>30000){lastExpiredRefresh=Date.now();refresh(true);}}
  }
  function refreshBusy(busy){
    for(const button of root?.querySelectorAll('.refresh')||[]){
      button.setAttribute('aria-busy',String(busy));button.setAttribute('aria-disabled',String(busy));
      button.dataset.i18nAria=busy?'refreshing':'refresh';button.title=t(button.dataset.i18nAria);button.setAttribute('aria-label',button.title);
    }
  }
  function refreshManually(){
    if(manualRequest)return manualRequest.promise;
    closeGroup();refreshBusy(true);const started=performance.now();
    const epoch=requestEpoch,request={};manualRequest=request;
    request.promise=(async()=>{
      try{if(pending)await refreshRequest;if(!disposed&&epoch===requestEpoch)await refresh(true);}
      finally{
        // A fast cached response still needs visible press feedback. This does
        // not delay data updates; only the indicator has a 250ms minimum.
        const remaining=250-(performance.now()-started);
        if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
        if(manualRequest===request){refreshBusy(false);manualRequest=null;}
      }
    })();
    return request.promise;
  }
  function refresh(force=false,opts={}){
    if(disposed)return;
    if(syncConversation())render();
    if(pending)return refreshRequest;
    if(!node?.isConnected)return;
    const conversation=conversationId();
    const epoch=requestEpoch;
    const current=()=>!disposed&&epoch===requestEpoch&&conversation===conversationId()&&conversation===lastConversation&&node?.isConnected;
    const preferCached=!force&&opts.preferCached===true;
    const sessionOnly=!force&&opts.sessionOnly===true&&Boolean(data&&(data.groups?.length||data.usage))&&Date.now()-lastFullFetch<30000;
    const payload={conversationId:conversation,force};
    if(preferCached)payload.preferCached=true;
    if(sessionOnly)payload.sessionOnly=true;
    pending=true;lastFetch=Date.now();
    refreshRequest=(async()=>{
      try{
        const result=await host().getMetrics(payload);
        if(!current()||result?.superseded)return result;
        if(result.enabled===false){node.style.visibility='hidden';hide();return result;}
        node.style.visibility='';
        let nextSpeed=result.speed||null;
        if(!conversation||nextSpeed&&nextSpeed.conversationId!==conversation)nextSpeed=null;
        if(nextSpeed&&conversation)cacheSpeed(conversation,nextSpeed);
        if(result.partial===true&&data){
          data={
            ...data,
            connection:result.connection||data.connection,
            error:result.error??data.error,
            sessionError:result.sessionError??null,
            serverTime:result.serverTime||data.serverTime,
            speed:nextSpeed??(preferCached?data.speed:null),
            persistenceError:result.persistenceError??data.persistenceError,
          };
        }else{
          lastFullFetch=Date.now();
          result.speed=nextSpeed;
          data=result;
          if(result.preferences){syncGuide(result.preferences);preferences.sync(result.preferences);guideReady=!preferences.error;}
          if(Object.hasOwn(result,'theme')){themeController?.setHostTheme(result.theme);}
        }
        render();
        return result;
      }
      catch{if(current()&&data){data.connection='stale';data.error=t('reconnecting');render();}}
      finally{if(epoch===requestEpoch){pending=false;refreshRequest=null;}}
    })();
    return refreshRequest;
  }
  const observer=new MutationObserver(records=>{
    const relevant=records.some(record=>{
      const tEl=record.target;
      if(tEl===node||node?.contains(tEl))return false;
      if(tEl instanceof Element&&(tEl.hasAttribute('data-ag-pulse-quota-ext')||tEl.closest('[data-ag-pulse-quota-ext]')))return false;
      if(record.type==='attributes'&&['data-ag-pulse-usage-popup','data-ag-pulse-has-est','data-ag-pulse-quota-level'].includes(record.attributeName))return false;
      return true;
    });
    if(relevant){
      scheduleLayout();
      scheduleNativeUsageSync();
    }
  });observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','hidden','inert','data-cascade-id','data-testid','data-tooltip-id','aria-label','role','contenteditable','data-side']});
  const onKey=e=>{if(e.key==='Escape')hide();}, onPointer=e=>{if(node&&!e.composedPath().includes(node))hide();};
  const onViewport=()=>{scheduleLayout();scheduleNativeUsageSync();};
  document.addEventListener('keydown',onKey);document.addEventListener('pointerdown',onPointer);
  window.addEventListener('resize',onViewport);document.addEventListener('scroll',onViewport,true);
  densityMedia.addEventListener('change',stopDensityMotion);
  restartSampleTimer();
  liveTimerId=setInterval(()=>{if(!disposed&&(cardName==='speed'||miniName==='speed')&&data?.speed?.liveTiming?.isRunning)updateLiveTiming();},200);
  const timerId=setInterval(()=>{mount();fit();tick();position();syncNativeUsagePanel();if(conversationId()!==lastConversation){if(syncConversation())render();}else if(!switchTimer&&Date.now()-lastFetch>(document.hidden?10000:2200))refresh();},1000);
  window.__agPulseDispose=()=>{
    disposed=true;requestEpoch++;pending=false;refreshRequest=null;clearTimeout(switchTimer);switchTimer=null;convoCache.clear();stopDensityMotion();densityFrame=null;densityProbe=null;
    cardAnim?.cancel();cardAnim=null;cardBodyAnim?.cancel();cardBodyAnim=null;miniAnim?.cancel();miniAnim=null;clearExitStage();
    clearInterval(timerId);clearInterval(sampleTimerId);clearInterval(liveTimerId);clearTimeout(hoverTimer);clearTimeout(openTimer);if(layoutFrame!==null)cancelAnimationFrame(layoutFrame);observer.disconnect();resizeObserver?.disconnect();themeController?.dispose();preferences.dispose();hide({immediate:true});usageDashboard?.dispose();disposeNativeUsagePanel();node?.remove();
    document.removeEventListener('keydown',onKey);document.removeEventListener('pointerdown',onPointer);
    document.removeEventListener('scroll',onViewport,true);window.removeEventListener('resize',onViewport);
    densityMedia.removeEventListener('change',stopDensityMotion);
    document.removeEventListener('DOMContentLoaded',mount);node=null;root=null;composer=null;
    window.__agPulseInlineInstalled=false;delete window.__agPulseDispose;
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
};
