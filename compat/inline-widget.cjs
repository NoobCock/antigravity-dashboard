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
  const HOVER_DELAY=250,WARM_WINDOW=350,LEAVE_DELAY=120;
  const isWarm=()=>Boolean(cardName||Date.now()<warmUntil);
  let chosen=localGet('ag-pulse-group'),group=null;
  let refreshRequest=null,manualRequest=null,requestEpoch=0,disposed=false;
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
    stopDensityMotion();densityFrame=null;densityProbe=null;
    manualRequest=null;refreshBusy(false);
    data={connection:'offline',groups:[],speed:null};group=null;hide();
    // Navigation has its own refresh budget. A request from the old composer
    // must neither block the new route nor reset its polling clock on arrival.
    queueMicrotask(()=>{if(!disposed)refresh();});return true;
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
      if(control.closest('[hidden],[inert]')||getComputedStyle(control).visibility==='hidden')continue;
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
        if(control.closest('[hidden],[inert]')||getComputedStyle(control).visibility==='hidden')continue;
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
  const isModelLocked=el=>Boolean(el?.isConnected&&(el.getAttribute('aria-disabled')==='true'||el.disabled===true));
  const ORIG_SET_MODEL=Symbol('agPulseOrigSetSelectedModel');
  const NATIVE_MODEL_STYLE_ID='ag-pulse-native-model-style';
  const NATIVE_MODEL_NOTE_ID='ag-pulse-native-model-note';
  const DEFERRED_MODEL_TIP='Model will be changed after this turn';
  let watchedModel=null,queuedSwitch=null,nativeMenuForced=false,nativeOpenedAt=0,nativeOpenTimer=null,nativeCloseTimer=null,nativeModelStyle=null,nativeStoreUnsub=null,nativeReasserting=false;
  const patchedContexts=new Set();
  const ensureNativeModelStyle=()=>{
    if(nativeModelStyle?.isConnected)return;
    nativeModelStyle=document.getElementById(NATIVE_MODEL_STYLE_ID);
    if(!nativeModelStyle){
      nativeModelStyle=document.createElement('style');
      nativeModelStyle.id=NATIVE_MODEL_STYLE_ID;
      nativeModelStyle.textContent='@layer base{html body button[data-testid="model-selector-trigger"][aria-disabled="true"]{cursor:pointer!important;opacity:1!important}html body button[data-testid="model-selector-trigger"][aria-disabled="true"]:hover{background-color:var(--color-secondary,rgba(128,128,128,.12))!important}}html body button[data-testid="model-selector-trigger"][aria-disabled="true"]{cursor:pointer!important;opacity:1!important}[data-ag-pulse-model-open="1"] [role="tooltip"],[data-ag-pulse-model-open="1"] .react-tooltip{opacity:0!important;visibility:hidden!important;pointer-events:none!important}#'+NATIVE_MODEL_NOTE_ID+'{font-size:11px;font-weight:400;opacity:.75;white-space:nowrap;flex:none}';
      (document.head||document.documentElement).append(nativeModelStyle);
    }
  };
  const rewriteLockedModelTooltips=()=>{
    if(!isModelLocked(watchedModel))return;
    for(const tip of document.querySelectorAll('[role="tooltip"]')){
      if(/Model cannot be changed while the agent is running/i.test(tip.textContent||'')){
        tip.textContent=DEFERRED_MODEL_TIP;
      }
    }
  };
  const syncNativeMenuNote=popup=>{
    if(!popup?.isConnected)return;
    const existing=popup.querySelector('#'+NATIVE_MODEL_NOTE_ID);
    if(!nativeMenuForced||!isModelLocked(watchedModel)){existing?.remove();return;}
    if(existing)return;
    const header=Array.from(popup.querySelectorAll('div,span,p')).find(el=>el.children.length===0&&/^Model$/i.test((el.textContent||'').trim()));
    if(!header)return;
    const note=document.createElement('span');
    note.id=NATIVE_MODEL_NOTE_ID;
    note.textContent=DEFERRED_MODEL_TIP;
    header.style.display='flex';
    header.style.alignItems='baseline';
    header.style.justifyContent='space-between';
    header.style.gap='8px';
    header.append(note);
  };
  const setNativeModelOpenAttr=open=>{
    if(open)document.documentElement.dataset.agPulseModelOpen='1';
    else delete document.documentElement.dataset.agPulseModelOpen;
  };
  const findModelSelectorParts=el=>{
    if(!el?.isConnected)return null;
    try{
      const fk=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));
      let f=fk?el[fk]:null,store=null,ctx=null,ctxFiber=null;
      for(let i=0;i<30&&f;i++,f=f.return){
        const v=f.memoizedProps?.value;
        if(!store&&v&&typeof v==='object'&&v.store&&typeof v.store.update==='function')store=v.store;
        if(!ctx&&v&&typeof v==='object'&&typeof v.setSelectedModel==='function'&&Array.isArray(v.modelOptions)){ctx=v;ctxFiber=f;}
        if(store&&ctx)break;
      }
      return (store||ctx)?{store,ctx,ctxFiber}:null;
    }catch{return null;}
  };
  const wrapModelContextTarget=target=>{
    if(!target||typeof target.setSelectedModel!=='function'||target.setSelectedModel[ORIG_SET_MODEL])return;
    const orig=target.setSelectedModel;
    const wrapped=option=>{
      if(isModelLocked(watchedModel)||target.lockedReason!==undefined){
        queueModelSwitch(option);
        closeNativeModelMenu();
        return;
      }
      return orig(option);
    };
    wrapped[ORIG_SET_MODEL]=orig;
    target.setSelectedModel=wrapped;
    patchedContexts.add(target);
  };
  const patchModelContext=el=>{
    const parts=findModelSelectorParts(el);
    if(!parts?.ctxFiber)return parts;
    wrapModelContextTarget(parts.ctxFiber.memoizedProps?.value);
    wrapModelContextTarget(parts.ctxFiber.alternate?.memoizedProps?.value);
    return parts;
  };
  const restorePatchedContexts=()=>{
    for(const target of patchedContexts){
      try{
        const orig=target?.setSelectedModel?.[ORIG_SET_MODEL];
        if(typeof orig==='function')target.setSelectedModel=orig;
      }catch{}
    }
    patchedContexts.clear();
  };
  const shortModelLabel=label=>String(label||'').replace(/^Gemini\s+/i,'').replace(/^Claude\s+/i,'').replace(/\s*\(([^)]+)\)\s*$/,' $1').replace(/\bXHigh\b/i,'XHigh').trim();
  const normModelName=s=>String(s||'').replace(/[()]/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
  const sameModelOption=(a,b)=>{
    if(!a||!b)return false;
    if(a===b)return true;
    if(a.value!=null&&b.value!=null&&a.value===b.value)return true;
    if(a.modelId&&b.modelId&&a.modelId===b.modelId)return true;
    if(a.model&&b.model&&a.model===b.model)return true;
    const al=normModelName(a.label),bl=normModelName(b.label);
    return Boolean(al&&bl&&al===bl);
  };
  const renderQueuedChip=()=>{
    const chip=$('queued-model-chip');if(!chip)return;
    const valid=Boolean(queuedSwitch&&(!queuedSwitch.conversationId||queuedSwitch.conversationId===conversationId()));
    hidden(chip,!valid);
    if(!valid)return;
    text('queued-model-label',`→ ${queuedSwitch.shortLabel}`);
    chip.title=t('modelsQueuedTip',{model:queuedSwitch.label});
    chip.setAttribute('aria-label',chip.title);
  };
  const queueModelSwitch=option=>{
    if(!option)return;
    const ctx=findModelSelectorParts(watchedModel)?.ctx;
    const cur=ctx?.selectedModel;
    const curBtnLabel=watchedModel?.getAttribute('data-model-label')||'';
    const isCurrent=sameModelOption(cur,option)||(curBtnLabel&&normModelName(curBtnLabel)===normModelName(option.label));
    if(isCurrent||sameModelOption(queuedSwitch,option)){
      queuedSwitch=null;
    }else{
      queuedSwitch={conversationId:conversationId(),value:option.value,modelId:option.modelId||null,model:option.model||null,label:option.label,shortLabel:shortModelLabel(option.label)};
    }
    renderQueuedChip();
    fit();
  };
  const isNativeMenuHovered=()=>{
    if(watchedModel?.matches(':hover'))return true;
    const store=findModelSelectorParts(watchedModel)?.store;
    if(store?.state?.popupElement?.matches(':hover'))return true;
    for(const m of document.querySelectorAll('[data-base-ui-portal] [role="menu"]'))if(m.matches(':hover'))return true;
    return false;
  };
  const isInsideNativeMenus=target=>{
    if(!(target instanceof Element))return false;
    if(watchedModel&&(target===watchedModel||watchedModel.contains(target)))return true;
    const store=findModelSelectorParts(watchedModel)?.store;
    if(store?.state?.popupElement?.contains(target))return true;
    return Boolean(target.closest('[data-base-ui-portal] [role="menu"]'));
  };
  const unsubNativeStore=()=>{
    if(typeof nativeStoreUnsub==='function'){try{nativeStoreUnsub();}catch{}}
    nativeStoreUnsub=null;
  };
  const closeNativeModelMenu=()=>{
    clearTimeout(nativeOpenTimer);nativeOpenTimer=null;
    clearTimeout(nativeCloseTimer);nativeCloseTimer=null;
    unsubNativeStore();
    const wasForced=nativeMenuForced;
    nativeMenuForced=false;
    nativeOpenedAt=0;
    setNativeModelOpenAttr(false);
    document.getElementById(NATIVE_MODEL_NOTE_ID)?.remove();
    if(!wasForced)return;
    const store=findModelSelectorParts(watchedModel)?.store;
    if(store?.state?.open||store?.state?.openProp||store?.state?.mounted){
      try{store.update({open:false,openProp:false,mounted:false});}catch{}
    }
  };
  const scheduleCloseNativeMenu=()=>{
    clearTimeout(nativeCloseTimer);
    nativeCloseTimer=setTimeout(()=>{
      nativeCloseTimer=null;
      if(nativeMenuForced&&!isNativeMenuHovered())closeNativeModelMenu();
    },260);
  };
  const openNativeModelMenu=()=>{
    if(disposed||!isModelLocked(watchedModel)||usageDashboard?.isOpen)return;
    clearTimeout(nativeOpenTimer);nativeOpenTimer=null;
    clearTimeout(nativeCloseTimer);nativeCloseTimer=null;
    hide();
    const parts=patchModelContext(watchedModel);
    if(!parts?.store)return;
    const {store}=parts;
    unsubNativeStore();
    nativeMenuForced=true;
    nativeOpenedAt=Date.now();
    setNativeModelOpenAttr(true);
    rewriteLockedModelTooltips();
    const openState={open:true,openProp:true,mounted:true,allowMouseEnter:true,hoverEnabled:true,openMethod:'mouse',activeTriggerElement:watchedModel,activeTriggerId:watchedModel.id||null};
    try{
      store.update(openState);
      if(typeof store.subscribe==='function'){
        nativeStoreUnsub=store.subscribe(()=>{
          if(!nativeMenuForced||nativeReasserting||disposed||!isModelLocked(watchedModel))return;
          const st=store.state;
          if(st&&(!st.open||!st.openProp||!st.mounted)){
            nativeReasserting=true;
            try{store.update(openState);}finally{nativeReasserting=false;}
          }
          if(st?.popupElement)syncNativeMenuNote(st.popupElement);
        });
      }
      requestAnimationFrame(()=>{if(nativeMenuForced&&store.state?.popupElement)syncNativeMenuNote(store.state.popupElement);});
    }catch{
      unsubNativeStore();nativeMenuForced=false;nativeOpenedAt=0;setNativeModelOpenAttr(false);
    }
  };
  const flushQueuedModelSwitch=()=>{
    if(nativeMenuForced&&!isModelLocked(watchedModel)){
      unsubNativeStore();nativeMenuForced=false;nativeOpenedAt=0;setNativeModelOpenAttr(false);
      document.getElementById(NATIVE_MODEL_NOTE_ID)?.remove();
      clearTimeout(nativeCloseTimer);nativeCloseTimer=null;
    }
    if(!queuedSwitch)return;
    const cid=conversationId();
    if(queuedSwitch.conversationId&&cid&&queuedSwitch.conversationId!==cid){queuedSwitch=null;renderQueuedChip();return;}
    if(!watchedModel?.isConnected||isModelLocked(watchedModel))return;
    const ctx=findModelSelectorParts(watchedModel)?.ctx;
    if(!ctx||ctx.lockedReason!==undefined)return;
    const target=(ctx.modelOptions||[]).find(m=>!m.disabled&&sameModelOption(m,queuedSwitch));
    queuedSwitch=null;
    renderQueuedChip();
    if(target){
      const apply=ctx.setSelectedModel?.[ORIG_SET_MODEL]||ctx.setSelectedModel;
      try{apply(target);}catch{}
    }
    fit();
  };
  const onModelEnter=()=>{
    if(!isModelLocked(watchedModel)||usageDashboard?.isOpen)return;
    rewriteLockedModelTooltips();
    clearTimeout(nativeCloseTimer);nativeCloseTimer=null;
    if(nativeMenuForced)return;
    clearTimeout(nativeOpenTimer);
    const target=watchedModel,conversation=conversationId();
    nativeOpenTimer=setTimeout(()=>{
      nativeOpenTimer=null;
      if(disposed||watchedModel!==target||!target?.isConnected||!target.matches(':hover')||!isModelLocked(target)||conversationId()!==conversation)return;
      openNativeModelMenu();
    },60);
  };
  const onModelLeave=()=>{
    clearTimeout(nativeOpenTimer);nativeOpenTimer=null;
    if(nativeMenuForced)scheduleCloseNativeMenu();
  };
  const onModelClick=event=>{
    if(!isModelLocked(watchedModel)||usageDashboard?.isOpen)return;
    event.preventDefault();event.stopPropagation();
    if(nativeMenuForced){
      if(Date.now()-nativeOpenedAt>450)closeNativeModelMenu();
    }else{
      openNativeModelMenu();
    }
  };
  const onNativeMenuPointerMove=()=>{
    if(!nativeMenuForced)return;
    if(isNativeMenuHovered()){clearTimeout(nativeCloseTimer);nativeCloseTimer=null;}
    else if(!nativeCloseTimer)scheduleCloseNativeMenu();
  };
  const onNativeMenuSelectGuard=event=>{
    if(!nativeMenuForced||!isModelLocked(watchedModel))return;
    if(event.type==='keydown'&&event.key!=='Enter'&&event.key!==' ')return;
    const target=event.target instanceof Element?event.target:null;
    if(!target||target===watchedModel||watchedModel?.contains(target))return;
    const menuItem=target.closest('[data-base-ui-portal] [role="menuitem"],[data-base-ui-portal] [role="menuitemradio"]');
    if(!menuItem)return;
    const parts=findModelSelectorParts(watchedModel);
    if(parts?.ctx?.setSelectedModel?.[ORIG_SET_MODEL])return;
    // Context was recreated by a React re-render while open; never leak an unwrapped switch mid-turn.
    event.preventDefault();event.stopImmediatePropagation();
    patchModelContext(watchedModel);
    const lbl=menuItem.getAttribute('data-model-label')||'';
    const match=lbl&&(parts?.ctx?.modelOptions||[]).find(m=>!m.disabled&&m.label===lbl);
    if(match)queueModelSwitch(match);
    closeNativeModelMenu();
  };
  function bindModelTrigger(el){
    const next=el||null;
    if(watchedModel===next)return;
    if(watchedModel){
      closeNativeModelMenu();
      watchedModel.removeEventListener('pointerenter',onModelEnter);
      watchedModel.removeEventListener('pointerleave',onModelLeave);
      watchedModel.removeEventListener('click',onModelClick,true);
    }
    watchedModel=next;
    if(watchedModel){
      ensureNativeModelStyle();
      watchedModel.addEventListener('pointerenter',onModelEnter);
      watchedModel.addEventListener('pointerleave',onModelLeave);
      watchedModel.addEventListener('click',onModelClick,true);
    }
  }
  const cardEngaged=()=>Boolean(root?.activeElement?.matches(':focus-visible')||(guideOpened&&!guideDismissed&&cardName==='context'&&root?.activeElement?.matches('[data-language-choice]'))||groupMenu||node?.matches(':hover')||root?.querySelector('.card:not([hidden]):hover'));
  function cardVisibility(element,visible){
    if(visible){hidden(element,false);if(element.hasAttribute('popover')&&!element.matches(':popover-open'))element.showPopover();}
    else {if(element.hasAttribute('popover')&&element.matches(':popover-open'))element.hidePopover();hidden(element,true);}
  }
  function hide({keepWarm=false}={}){
    clearTimeout(openTimer);openTimer=null;
    clearTimeout(hoverTimer);hoverTimer=null;
    if(!keepWarm)warmUntil=0;
    changingCards=true;
    try{closeGroup();cardName=null;for(const e of root?.querySelectorAll('[data-card]')||[])e.setAttribute('aria-expanded','false');for(const e of root?.querySelectorAll('.card')||[])cardVisibility(e,false);}
    finally{changingCards=false;}
    updateGuide();
  }
  function show(name){
    if(disposed||!node?.isConnected||changingCards||usageDashboard?.isOpen||node.dataset.layout==='blocked')return;
    if(cardName!==name)closeGroup();
    clearTimeout(hoverTimer);hoverTimer=null;
    clearTimeout(openTimer);openTimer=null;
    cardName=name;warmUntil=0;
    for(const e of root.querySelectorAll('[data-card]'))e.setAttribute('aria-expanded',String(e.dataset.card===name));
    changingCards=true;
    try{for(const e of root.querySelectorAll('.card'))cardVisibility(e,e.id===`${name}-card`);}
    finally{changingCards=false;}
    updateGuide();
    position();
  }
  function hoverChip(name){
    clearTimeout(hoverTimer);
    if(isWarm()){
      clearTimeout(openTimer);openTimer=null;
      show(name);
    }else{
      clearTimeout(openTimer);
      const anchor=node,chip=root?.querySelector(`[data-card="${name}"]`),editor=composer?.editor,conversation=conversationId();
      openTimer=setTimeout(()=>{
        openTimer=null;
        // A host route/composer replacement can detach the chip without a
        // pointerleave. Never show a stale or disconnected top-layer popover.
        if(disposed||node!==anchor||!anchor?.isConnected||!chip?.isConnected||!chip.matches(':hover')||composer?.editor!==editor||conversationId()!==conversation)return;
        show(name);
      },HOVER_DELAY);
    }
  }
  function leaveChip(){
    clearTimeout(openTimer);openTimer=null;
  }
  function scheduleHide(){
    clearTimeout(openTimer);openTimer=null;
    clearTimeout(hoverTimer);
    // Measure the warm window from pointer departure, not the later hide.
    if(cardName)warmUntil=Date.now()+WARM_WINDOW;
    hoverTimer=setTimeout(()=>{hoverTimer=null;if(!cardEngaged())hide({keepWarm:true});},LEAVE_DELAY);
  }
  function position(){
    positionGuide();
    if(!cardName)return;
    const button=root.querySelector(`[data-card="${cardName}"]`),card=$(`${cardName}-card`);
    if(!button||!card)return;
    const rect=button.getBoundingClientRect();
    const width=Math.min(310,window.innerWidth-24);style(card,'width',`${width}px`);
    const roomAbove=rect.top-21,roomBelow=window.innerHeight-rect.bottom-21;
    style(card,'overflow-y','auto');
    style(card,'left',`${Math.min(window.innerWidth-width-12,Math.max(12,rect.left+rect.width/2-width/2))}px`);
    // scrollHeight includes clipped content. Expanding maxHeight to measure it
    // on every poll used to reset scrollTop and then shrink the card again.
    const height=card.scrollHeight+card.offsetHeight-card.clientHeight;
    const useAbove=height<=roomAbove || roomAbove>=roomBelow;
    style(card,'max-height',`${Math.max(80,useAbove?roomAbove:roomBelow)}px`);
    style(card,'top',`${Math.max(12,useAbove?rect.top-card.offsetHeight-9:rect.bottom+9)}px`);
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
    const visible=!disposed&&guideReady&&!guideDismissed&&!guideOpened&&!cardName&&node?.isConnected&&['main','ide'].includes(composer?.kind)&&node.dataset.layout==='ready'&&node.style.visibility!=='hidden';
    const entering=visible&&tip.hidden;
    cardVisibility(tip,visible);
    const button=root.querySelector('[data-card="context"]');
    if(visible)button.setAttribute('aria-describedby','language-guide');else button.removeAttribute('aria-describedby');
    text('guide-save-note',guideError?'Could not save. Please retry. / 未能保存，请重试。':'');
    $('guide-close').disabled=guideSaving;
    positionGuide();
    if(entering)tip.animate([{opacity:0,transform:`translateY(${tip.dataset.side==='above'?'4':'-4'}px)`},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:'cubic-bezier(0.23,1,0.32,1)'});
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
      bindModelTrigger(null);
      stopDensityMotion();densityFrame=null;densityProbe=null;composer=null;resizeObserver?.disconnect();
      if(node){
        hide();usageDashboard?.dispose();usageDashboard=null;themeController?.dispose();themeController=null;
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
    bindModelTrigger(model);
    if(node)node.dataset.scope=found.kind;
    if(node?.isConnected&&node.parentElement===row&&node.previousElementSibling===branch)return;
    if(node){stopDensityMotion();densityFrame=null;densityProbe=null;hide();row.insertBefore(node,branch.nextSibling);observeComposer();themeController?.dispose();themeController=theme.attach(node,{embedded:true});if(data?.theme)themeController.setHostTheme(data.theme);fit();position();return;}
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
    .bar{gap:6px}.chip{font-size:11px;gap:5px;padding:3px 5px}.context-card>strong{font-size:16px}.context-card>p{margin:8px 0}.quota-heading{margin-top:14px;padding-top:12px;border-top:1px solid var(--pulse-separator)}.quota-title{display:flex;align-items:center;gap:6px;font-size:11px}.quota-title>span:first-child{display:flex;align-items:center;gap:6px;margin-right:auto}.quota-title strong{font-variant-numeric:tabular-nums;font-size:13px}.quota-section+.quota-section{border-top:1px solid var(--pulse-separator);margin-top:12px;padding-top:12px}.quota-section .track{margin:8px 0}.quota-section .footnote{margin-top:6px}.quota-section dl div{margin:6px 0}.context-label{white-space:nowrap}
    :host(.icons-only) .bar{gap:2px}:host(.icons-only) .chip{flex:0 0 24px;width:24px;min-width:24px;height:24px;padding:0;gap:0;justify-content:center}:host(.icons-only) .chip>:not(svg):not(.context-ring){display:none}:host(.icons-only) .bar>.language-button,:host(.icons-only) .bar>.dot{display:none}:host(.icons-only) .chip svg{display:block}.card-language{display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid var(--pulse-separator);font-size:10px;color:var(--pulse-muted)}
    .refresh{display:inline-grid;place-items:center}.refresh[aria-busy=true]{color:var(--pulse-emphasis);cursor:wait}.refresh[aria-busy=true] svg{animation:pulse-refresh-spin 1s linear infinite;transform-origin:center}
    @keyframes pulse-refresh-spin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){.refresh[aria-busy=true] svg{animation:none;opacity:.65}}
    </style><div class="bar" data-i18n-aria="strip" aria-label="Dashboard statistics">
      <span class="dot" id="dot" title="Connecting"></span>
      <button type="button" class="chip queued-chip" id="queued-model-chip" hidden><span id="queued-model-label"></span><span class="queued-x" aria-hidden="true">×</span></button>
      <button class="chip" data-card="speed" data-i18n-aria="session" hidden aria-controls="speed-card" aria-expanded="false">${svg('speed')}<span class="rounds dim" id="rounds"></span><strong id="tps">—</strong><span>tok/s</span></button>
      <button class="chip" data-card="cache" data-i18n-aria="cacheTitle" hidden aria-controls="cache-card" aria-expanded="false">${svg('cache')}<span class="cache-total" id="cache-total">— tok</span><i class="chip-sep" aria-hidden="true"></i><span data-i18n="cache">Cache hit</span><strong id="cache-rate">—</strong></button>
      <button class="chip" data-card="context" data-i18n-aria="context" hidden aria-controls="context-card" aria-expanded="false"><span class="context-ring" id="context-ring" aria-hidden="true"></span><span class="context-label" data-i18n="contextShort">Ctx</span><strong id="context-percent">—</strong></button>
    </div><section class="card" id="speed-card" role="region" data-i18n-aria="session" aria-label="Session statistics" hidden>
      <div class="heading"><span>${svg('speed')}<span data-i18n="session">Session statistics</span></span><span class="tag" id="samples">—</span></div>
      <dl>${[['modelTime','model-time'],['toolTime','tool-time'],['ttft','ttft'],['sessionTps','session-rate'],['latest','latest-rate'],['tokens','tokens']].map(([key,id])=>`<div><dt data-i18n="${key}">${t(key)}</dt><dd id="${id}">—</dd></div>`).join('')}</dl><p class="footnote" id="rate-note">${t('responseBasis')}</p>
    </section><section class="card" id="cache-card" role="region" data-i18n-aria="cacheTitle" aria-label="Token cache" hidden>
      <div class="heading"><span>${svg('cache')}<span data-i18n="cacheTitle">Token cache</span></span><span class="tag" id="cache-coverage">—</span></div>
      <dl>${[['cacheRate','cache-detail-rate'],['cacheMiss','cache-miss'],['cacheRead','cache-read'],['cacheOutput','cache-output'],['cacheWrite','cache-write']].map(([key,id])=>`<div ${id==='cache-write'?'id="cache-write-row" hidden':''}><dt data-i18n="${key}">${t(key)}</dt><dd id="${id}">—</dd></div>`).join('')}</dl><p class="footnote" id="cache-note">${t('cacheBasis')}</p>
    </section><section class="card context-card" id="context-card" role="region" data-i18n-aria="context" hidden>
      <div class="heading"><span>${svg('context')}<span data-i18n="context">Context window</span></span></div>
      <strong id="context-summary">—</strong><p id="context-tokens">—</p>
      <div class="track" role="progressbar" data-i18n-aria="context" id="context-track"><i id="context-fill"></i></div>
      <dl><div><dt data-i18n="contextModel">Model</dt><dd id="context-model">—</dd></div></dl><p class="footnote" id="context-note"></p>
      <div class="heading quota-heading"><span data-i18n="group">Quota group</span><div class="toolbar"><button class="group-trigger" data-i18n-aria="group" aria-haspopup="listbox" aria-expanded="false">Quota ▾</button><div class="group-menu" role="listbox" data-i18n-aria="selectGroup" hidden></div><button class="refresh" data-i18n-aria="refresh" aria-label="Refresh quota" title="Refresh quota"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.8 6a5.1 5.1 0 1 0 .1 4M12.8 2.5V6H9.2"/></svg></button></div></div>
      <div class="quota-details">${['five','week'].map(name=>`<section class="quota-section" data-i18n-aria="${name}" aria-label="${t(name)}"><div class="quota-title"><span>${svg(name)}<span data-i18n="${name}">${t(name)}</span></span><strong id="${name}-balance">—</strong><span class="dim" data-i18n="remaining">remaining</span></div><div class="track" role="progressbar" data-i18n-aria="${name}" id="${name}-track"><i id="${name}-fill"></i></div><dl><div><dt data-i18n="resetIn">Resets in</dt><dd class="reset" id="${name}-countdown">—</dd></div><div><dt data-i18n="resetTime">Reset time (UTC+8)</dt><dd id="${name}-reset">—</dd></div><div id="${name}-est-usd-row" hidden><dt data-i18n="estApiQuota">${t('estApiQuota')}</dt><dd id="${name}-est-usd">—</dd></div><div id="${name}-est-tok-row" hidden><dt data-i18n="estRemaining">${t('estRemaining')}</dt><dd class="reset" id="${name}-est-tok">—</dd></div></dl><p class="footnote" id="${name}-note">${t('loadingQuota')}</p></section>`).join('')}</div>
    </section>`);
    row.insertBefore(node,branch.nextSibling);
    for(const card of root.querySelectorAll('.card')){const note=document.createElement('p');note.className='scope-note';note.dataset.i18n='subagentStats';card.querySelector('.heading').after(note);}
    const languageRow=document.createElement('div');languageRow.className='card-language';
    setMarkup(languageRow,'<span>Language / 语言</span><div class="language-options" role="group" aria-label="Language / 语言"><button type="button" class="language-button" id="card-language-en" data-language-choice="en">English</button><button type="button" class="language-button" id="card-language-zh" data-language-choice="zh-CN">简体中文</button></div>');
    $('context-card').append(languageRow);
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
      .language-options .language-button{font-size:10px;padding:3px 6px;margin:0;border-radius:4px;color:var(--pulse-muted);line-height:16px;transition:background-color 140ms ease,color 140ms ease,transform 120ms ease}
      .language-options .language-button[aria-pressed=true]{color:var(--pulse-foreground);background:var(--pulse-hover);box-shadow:0 1px 2px var(--pulse-shadow)}
      .language-options .language-button:active{transform:scale(.97)}
      .language-guide{position:fixed;inset:auto;margin:0;padding:10px 12px;border:1px solid var(--pulse-border);border-radius:10px;background:var(--pulse-card);color:var(--pulse-foreground);box-shadow:0 4px 16px var(--pulse-shadow);font-size:11px;z-index:2147483000;overflow:visible}
      .language-guide[hidden]{display:none}.language-guide::backdrop{background:transparent;pointer-events:none}
      .language-guide::after{content:'';position:absolute;left:calc(var(--guide-anchor) - 4px);width:7px;height:7px;transform:rotate(45deg);background:var(--pulse-card);pointer-events:none}
      .language-guide[data-side=above]::after{bottom:-4px;border-right:1px solid var(--pulse-border);border-bottom:1px solid var(--pulse-border)}
      .language-guide[data-side=below]::after{top:-4px;border-left:1px solid var(--pulse-border);border-top:1px solid var(--pulse-border)}
      .guide-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:18px}
      .guide-heading strong{font-size:11px;font-weight:600}.guide-heading strong span{font-weight:400;color:var(--pulse-muted)}
      .language-guide button{border:0;background:transparent;color:var(--pulse-muted);border-radius:4px;cursor:pointer;font:inherit;transition:color 140ms ease,background-color 140ms ease,transform 120ms ease}
      .language-guide button:hover{background:var(--pulse-hover);color:var(--pulse-foreground)}.language-guide button:active{transform:scale(.98)}
      #guide-close{font-size:15px;line-height:18px;width:20px;height:20px;margin:-3px -4px -3px 0;padding:0}
      #guide-open{display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;width:calc(100% + 8px);margin:5px -4px -3px;padding:4px;line-height:16px}
      #guide-open>span{display:grid;gap:1px}#guide-open span[lang]{font-size:10px;color:var(--pulse-muted)}#guide-open svg{width:14px;height:14px;flex:none}
      #guide-save-note:empty,#language-save-note:empty{display:none}#guide-save-note,#language-save-note{color:var(--pulse-warning)}
      .queued-chip{color:var(--pulse-accent)!important;background:color-mix(in srgb,var(--pulse-accent) 12%,transparent)!important;border-radius:99px!important;padding:2px 7px!important;font-size:10px!important;gap:4px!important;max-width:150px}.queued-chip:hover{background:color-mix(in srgb,var(--pulse-accent) 20%,transparent)!important}#queued-model-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.queued-x{opacity:.7;font-size:11px;line-height:1}
      .card-update{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid var(--pulse-separator);font-size:10px;color:var(--pulse-muted)}.card-update[hidden]{display:none}
      .update-info{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}.update-info[data-state=available]{color:var(--pulse-accent);font-weight:500}.update-info[data-state=updated]{color:var(--pulse-success)}.update-info[data-state=error]{color:var(--pulse-warning)}
      .update-actions{display:flex;align-items:center;gap:4px;flex:none}
      .update-btn{border:0;background:var(--pulse-control);color:var(--pulse-muted);border-radius:4px;font-size:10px;padding:3px 6px;line-height:14px;cursor:pointer;transition:background-color 140ms ease,color 140ms ease}.update-btn:hover:not(:disabled){background:var(--pulse-hover);color:var(--pulse-foreground)}.update-btn:disabled{opacity:.6;cursor:wait}.update-btn[data-primary=true]{background:color-mix(in srgb,var(--pulse-accent) 16%,transparent);color:var(--pulse-accent);font-weight:500}.update-btn[aria-pressed=true]{color:var(--pulse-foreground);background:var(--pulse-hover)}
    `;root.append(guideStyle);
    $('queued-model-chip').addEventListener('click',()=>{queuedSwitch=null;renderQueuedChip();fit();});
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
    $('guide-open').addEventListener('click',()=>{guideOpened=true;show('context');$('card-language-zh').scrollIntoView({block:'nearest'});$('card-language-zh').focus({preventScroll:true});});
    // Escape ancestor stacking/paint contexts; ordinary z-index cannot do this.
    if(typeof HTMLElement.prototype.showPopover==='function')for(const card of root.querySelectorAll('.card'))card.setAttribute('popover','manual');
    if(typeof guide.showPopover==='function')guide.setAttribute('popover','manual');
    themeController=theme.attach(node,{embedded:true});
    report('mounted',{editorFound:true,composerFound:true});
    observeComposer();
    for(const chip of root.querySelectorAll('[data-card]')){
      chip.addEventListener('pointerenter',()=>hoverChip(chip.dataset.card));chip.addEventListener('pointerleave',leaveChip);chip.addEventListener('focus',()=>{if(chip.matches(':focus-visible'))show(chip.dataset.card);});chip.addEventListener('click',()=>show(chip.dataset.card));
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
      setMarkup(section,'<dl class="usage-summary"><div><dt id="usage-today-label"></dt><dd><strong id="usage-today"></strong><span class="usage-unit">Token</span></dd></div><div><dt id="usage-month-label"></dt><dd><strong id="usage-month"></strong><span class="usage-unit">Token</span></dd></div></dl><button type="button" id="open-usage"><span id="usage-open-label"></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></button>');$('cache-card').append(section);
      const css=document.createElement('style');css.textContent='#usage-entry{border-top:1px solid var(--pulse-separator);padding-top:7px;margin-top:12px}#usage-entry[hidden]{display:none}#open-usage{width:100%;display:flex;justify-content:space-between;padding:8px 10px;margin-top:9px;border:1px solid var(--pulse-border);border-radius:7px;background:var(--pulse-control);color:var(--pulse-foreground);font:inherit;transition:background 140ms ease,transform 120ms ease}#open-usage:hover{background:var(--pulse-hover)}#open-usage:active{transform:scale(.98)}';root.append(css);
      css.textContent+=`
        #usage-entry{padding-top:13px;margin-top:14px}.usage-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding-bottom:13px;border-bottom:1px solid var(--pulse-separator)}
        .usage-summary>div{display:block;min-width:0;margin:0}.usage-summary dt{font-size:10px;line-height:16px;color:var(--pulse-muted);margin:0 0 5px}.usage-summary dd{display:flex;align-items:baseline;justify-content:flex-start;gap:5px;margin:0;white-space:nowrap;text-align:left;line-height:24px}
        .usage-summary strong{font-size:20px;font-weight:550;letter-spacing:-.5px;color:var(--pulse-foreground);font-variant-numeric:tabular-nums}.usage-unit{font-size:9px;letter-spacing:0;color:var(--pulse-muted)}
        #open-usage{align-items:center;min-height:34px;gap:12px;width:calc(100% + 12px);margin:5px -6px -3px;padding:7px 6px;border:0;border-radius:6px;background:transparent;color:var(--pulse-label);font-size:11px;text-align:left;line-height:20px}#open-usage:hover{background:var(--pulse-hover);color:var(--pulse-foreground)}#open-usage svg{width:14px;height:14px;color:var(--pulse-muted);flex:none}
      `;
      usageDashboard=window.__agPulseUsageFactory({root,language,setMarkup,hostLabel:surface?.usageHostLabel||'Antigravity',guideDismissed:usageGuideDismissed,onDismissGuide:async()=>{const saved=await host().setPreferences({usageGuideDismissed:true});if(saved?.usageGuideDismissed!==true)throw Error('Usage guide could not be saved');syncGuide(saved);},onLanguage:next=>preferences.choose(next),onRefresh:()=>refreshManually(),onPricing:host()?.updatePricing?input=>host().updatePricing(input):null});
      $('open-usage').addEventListener('click',()=>{const trigger=root.querySelector('[data-card=cache]');hide();usageDashboard.open(data?.usage,trigger);});
      const estEntry=document.createElement('div');estEntry.id='est-entry';estEntry.hidden=true;
      setMarkup(estEntry,'<button type="button" id="open-estimate"><span id="est-open-label"></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></button>');
      $('context-card').querySelector('.quota-details').after(estEntry);
      css.textContent+=`
        #est-entry{border-top:1px solid var(--pulse-separator);margin-top:10px;padding-top:6px}#est-entry[hidden]{display:none}
        #open-estimate{width:calc(100% + 12px);display:flex;align-items:center;justify-content:space-between;min-height:30px;gap:12px;margin:0 -6px;padding:5px 6px;border:0;border-radius:6px;background:transparent;color:var(--pulse-label);font:inherit;font-size:11px;text-align:left;cursor:pointer;transition:background 140ms ease,transform 120ms ease}#open-estimate:hover{background:var(--pulse-hover);color:var(--pulse-foreground)}#open-estimate:active{transform:scale(.98)}#open-estimate svg{width:14px;height:14px;color:var(--pulse-muted);flex:none}
      `;
      $('open-estimate').addEventListener('click',()=>{const trigger=root.querySelector('[data-card=context]');hide();usageDashboard.open(data?.usage,trigger,'estimate');});
    }
    localize();
    render();refresh();
  }
  function render(){
    if(!root||!data)return;
    syncConversation();
    if(usageDashboard){
      const available=Boolean(data.usage);hidden($('usage-entry'),!available);
      if($('est-entry'))hidden($('est-entry'),!available||!(data.quotaEstimate?.groups?.length));
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
    style($('context-fill'),'width',hasCapacity?`${Math.min(1,context.usedFraction)*100}%`:'0%');
    style($('context-fill'),'background',hasCapacity&&context.usedFraction>=.9?'var(--pulse-danger)':'');
    attribute($('context-track'),'aria-valuenow',hasCapacity?Math.min(100,context.usedFraction*100):null);attribute($('context-track'),'aria-valuemin','0');attribute($('context-track'),'aria-valuemax','100');
    text('tps',rate(speed?.tps));text('rounds',speed?t('rounds',{rounds:speed.rounds,steps:speed.steps}):'');
    text('samples',speed?(language.language==='zh-CN'?`${speed.rounds}轮 ${speed.steps}步，${speed.measuredRequests} 次`:`${speed.rounds} turns, ${speed.steps} steps (${speed.measuredRequests})`):t('waitingRequest'));text('model-time',seconds(speed?.modelSeconds));text('tool-time',seconds(speed?.toolSeconds));text('ttft',seconds(speed?.ttftSeconds));text('session-rate',`${rate(speed?.tps)} tok/s`);text('latest-rate',`${rate(speed?.latestTps)} tok/s`);text('tokens',speed?`${count(speed.counts.responseOutput)} / ${count(speed.counts.thinkingOutput)} tok`:'—');
    if(speed?.latestRateStatus==='unreliable')text('latest-rate',t('timingUnreliable'));
    if(speed?.latestRateStatus==='legacy'){text('latest-rate',t('ratePending'));text('session-rate',t('ratePending'));}
    const savedNote=speed?.restoredFromHistory?' '+t('savedStats',{time:speed.savedAt?language.resetDate(speed.savedAt):'—'}):'';
    const saveWarning=data.persistenceError?' '+t('saveFailed'):'';
    text('rate-note',[language.errorMessage(data.error||data.sessionError),language.rateNote(speed)].filter(Boolean).join(' ')+savedNote+saveWarning);
    const cache=speed?.cache;
    text('cache-rate',pct(cache?.hitRate));text('cache-detail-rate',pct(cache?.hitRate));
    text('cache-total',cache?.measuredRequests?`${compact(cache.totalTokens)} tok`:'— tok');
    text('cache-coverage',cache?.measuredRequests?`${count(cache.totalTokens)} tok`:'— tok');
    for(const [field,id]of[['cachedTokens','cache-read'],['uncachedTokens','cache-miss'],['cacheWriteTokens','cache-write'],['outputTokens','cache-output']])text(id,cache?.measuredRequests?`${count(cache[field])} tok`:'—');
    hidden($('cache-write-row'),!(cache?.cacheWriteTokens>0));
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
        text(`${name}-est-tok`,tok==null?'—':tok===0?(totTok!=null?`0 / ~${compact(totTok)}`:'0 tok'):(totTok!=null?`~${compact(tok)} / ~${compact(totTok)}`:`~${compact(tok)} tok`));
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
    attribute($('dot'),'class',`dot ${data.connection}`);attribute($('dot'),'title',t(data.connection==='live'?'live':data.connection==='stale'?'stale':'offline'));renderQueuedChip();renderUpdateRow();tick();fit();position();
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
    flushQueuedModelSwitch();
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
  function refresh(force=false){
    if(disposed)return;
    if(syncConversation())render();
    if(pending)return refreshRequest;
    if(!node?.isConnected)return;
    const conversation=conversationId();
    const epoch=requestEpoch;
    const current=()=>!disposed&&epoch===requestEpoch&&conversation===conversationId()&&conversation===lastConversation&&node?.isConnected;
    pending=true;lastFetch=Date.now();
    refreshRequest=(async()=>{
      try{const result=await host().getMetrics({conversationId:conversation,force});if(!current())return;node.style.visibility=result.enabled===false?'hidden':'';if(result.enabled===false){hide();return;}if(!conversation||result.speed&&result.speed.conversationId!==conversation)result.speed=null;data=result;if(result.preferences){syncGuide(result.preferences);preferences.sync(result.preferences);guideReady=!preferences.error;}if(Object.hasOwn(result,'theme'))themeController?.setHostTheme(result.theme);render();}
      catch{if(current()&&data){data.connection='stale';data.error=t('reconnecting');render();}}
      finally{if(epoch===requestEpoch){pending=false;refreshRequest=null;}}
    })();
    return refreshRequest;
  }
  const observer=new MutationObserver(records=>{if(records.some(record=>record.target!==node&&!node?.contains(record.target))){rewriteLockedModelTooltips();flushQueuedModelSwitch();scheduleLayout();}});observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','hidden','inert','data-cascade-id','data-testid','data-tooltip-id','aria-label','aria-disabled','disabled','role','contenteditable']});
  const onKey=e=>{if(e.key==='Escape'){hide();closeNativeModelMenu();}}, onPointer=e=>{if(node&&!e.composedPath().includes(node))hide();if(nativeMenuForced&&!isInsideNativeMenus(e.target))closeNativeModelMenu();};
  document.addEventListener('keydown',onKey);document.addEventListener('pointerdown',onPointer);
  document.addEventListener('pointermove',onNativeMenuPointerMove,{passive:true});
  document.addEventListener('click',onNativeMenuSelectGuard,true);
  document.addEventListener('keydown',onNativeMenuSelectGuard,true);
  window.addEventListener('resize',scheduleLayout);document.addEventListener('scroll',scheduleLayout,true);
  densityMedia.addEventListener('change',stopDensityMotion);
  const timerId=setInterval(()=>{mount();flushQueuedModelSwitch();if(nativeMenuForced&&!isNativeMenuHovered()&&!nativeCloseTimer)scheduleCloseNativeMenu();fit();tick();position();if(conversationId()!==lastConversation||Date.now()-lastFetch>(document.hidden?10000:2200))refresh();},1000);
  window.__agPulseDispose=()=>{
    disposed=true;requestEpoch++;pending=false;refreshRequest=null;stopDensityMotion();densityFrame=null;densityProbe=null;
    bindModelTrigger(null);closeNativeModelMenu();restorePatchedContexts();nativeModelStyle?.remove();nativeModelStyle=null;queuedSwitch=null;
    clearInterval(timerId);clearTimeout(hoverTimer);clearTimeout(openTimer);if(layoutFrame!==null)cancelAnimationFrame(layoutFrame);observer.disconnect();resizeObserver?.disconnect();themeController?.dispose();preferences.dispose();hide();usageDashboard?.dispose();node?.remove();
    document.removeEventListener('keydown',onKey);document.removeEventListener('pointerdown',onPointer);
    document.removeEventListener('pointermove',onNativeMenuPointerMove);
    document.removeEventListener('click',onNativeMenuSelectGuard,true);
    document.removeEventListener('keydown',onNativeMenuSelectGuard,true);
    document.removeEventListener('scroll',scheduleLayout,true);window.removeEventListener('resize',scheduleLayout);
    densityMedia.removeEventListener('change',stopDensityMotion);
    document.removeEventListener('DOMContentLoaded',mount);node=null;root=null;composer=null;
    window.__agPulseInlineInstalled=false;delete window.__agPulseDispose;
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
};
