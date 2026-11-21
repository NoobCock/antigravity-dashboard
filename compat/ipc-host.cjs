// Serialized into Antigravity's main process. Only the app's own local renderer
// can obtain sanitized Antigrative Dashboard metrics; no API credentials enter the renderer.
module.exports = function installAgPulseIpc(electron, authorities) {
  const http = require('node:http');
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const local = process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local')
    : process.platform === 'darwin' ? path.join(os.homedir(),'Library','Application Support')
    : process.env.XDG_DATA_HOME || path.join(os.homedir(),'.local','share');
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const offline = message => ({ connection:'offline', error:message, groups:[],speed:null,serverTime:new Date().toISOString() });
  let preferenceStore;
  electron.ipcMain.handle('ag-pulse:preferences',async(event,input={})=>{
    try {
      const origin=new URL(event.senderFrame?.url||event.sender.getURL());
      if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||!['http:','https:'].includes(origin.protocol))throw new Error('Invalid preference origin');
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['language','languageGuideDismissed','usageGuideDismissed'].includes(key)))throw new Error('Invalid preference input');
      if(!preferenceStore){
        const file=path.join(os.homedir(),'.gemini','config','plugins','antigravity-pulse','compat','preferences.mjs');
        preferenceStore=import(require('node:url').pathToFileURL(file).href).then(({PreferencesStore})=>new PreferencesStore());
      }
      const store=await preferenceStore;
      return Object.keys(input).length?await store.set(input):await store.get();
    }catch{preferenceStore=null;return {error:'Language preference could not be saved or read'};}
  });
  let pricingStore;
  electron.ipcMain.handle('ag-pulse:pricing',async(event,input={})=>{
    try {
      const origin=new URL(event.senderFrame?.url||event.sender.getURL());
      if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||!['http:','https:'].includes(origin.protocol))throw new Error('Invalid pricing origin');
      if(!pricingStore){
        const file=path.join(os.homedir(),'.gemini','config','plugins','antigravity-pulse','sidecars','panel','pricing.mjs');
        pricingStore=import(require('node:url').pathToFileURL(file).href).then(({PricingStore})=>new PricingStore());
      }
      const store=await pricingStore;
      return await store.handleAction(input);
    }catch{pricingStore=null;return {ok:false,error:'Pricing could not be updated'};}
  });
  electron.ipcMain.on('ag-pulse:diagnostic',(event,state={})=>{
    try {
      const origin=new URL(event.senderFrame?.url||event.sender.getURL());
      if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname))return;
      if(!['boot','mounted','mount-error'].includes(state.stage))return;
      const dir=path.join(os.homedir(),'.gemini','antigravity','sidecar_data','antigravity-pulse','panel','logs');
      fs.mkdirSync(dir,{recursive:true});
      const safe={stage:state.stage,hostFound:state.hostFound===true,editorFound:state.editorFound===true,composerFound:state.composerFound===true};
      fs.appendFileSync(path.join(dir,'widget.log'),`${new Date().toISOString()} ${JSON.stringify(safe)}\n`);
      if(state.stage==='mounted'&&state.editorFound===true&&state.composerFound===true){
        const dataDir=path.join(os.homedir(),'.gemini','antigravity','sidecar_data','antigravity-pulse','panel','data');
        fs.mkdirSync(dataDir,{recursive:true});
        fs.writeFileSync(path.join(dataDir,'integration-state.json'),JSON.stringify({state:'mounted',mode:'legacy',message:'Renderer connected via preload adapter',windows:1,checkedAt:new Date().toISOString()}));
      }
    }catch{}
  });
  electron.ipcMain.handle('ag-pulse:metrics', async (event, input={}) => {
    let origin;
    try { origin = new URL(event.senderFrame?.url || event.sender.getURL()); } catch { return offline('来源不可用'); }
    if (!['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || !['http:','https:'].includes(origin.protocol)) return offline('仅允许 Antigravity 本地界面');
    for(const [file,disabled] of [
      [path.join(local,'AntigravityPulse','settings.json'),s=>s.enabled===false],
      [path.join(os.homedir(),'.gemini','config','config.json'),s=>s.plugins?.['antigravity-pulse']?.enabled===false],
    ]) {
      try {if(disabled(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))))return {...offline('Antigrative Dashboard 已停用'),enabled:false};}catch{}
    }
    if (input.conversationId && !GUID.test(input.conversationId)) return offline('会话标识无效');
    const endpoints = [];
    try {
      const file=path.join(os.homedir(),'.gemini','antigravity','sidecar_data','antigravity-pulse','panel','logs','sidecar.log');
      const log=fs.readFileSync(file,'utf8').slice(-262144);
      const port=[...log.matchAll(/\[sidecar\] listening on 127\.0\.0\.1:(\d+)/g)].at(-1)?.[1];
      if(port)endpoints.push(`http://127.0.0.1:${port}/`);
    } catch {}
    const gateway = [...authorities].find(([key])=>key.startsWith('antigravity-pulse--panel-'))?.[1];
    if (gateway && !endpoints.includes(gateway)) endpoints.push(gateway);
    if (!endpoints.length) return offline('等待 Antigrative Dashboard 后台启动');
    const fetchMetrics = endpoint => new Promise((resolve, reject) => {
      try {
        const url=new URL(endpoint);
        if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.protocol!=='http:') { reject(new Error('Invalid endpoint')); return; }
        url.hostname='127.0.0.1'; url.pathname='/api/metrics';url.search='';
        if(input.conversationId)url.searchParams.set('conversationId',input.conversationId);
        if(input.force===true)url.searchParams.set('force','1');
        const req=http.get(url,res=>{
          let body='';res.setEncoding('utf8');
          res.on('data',chunk=>{body+=chunk;if(body.length>1048576)req.destroy(new Error('Metrics too large'));});
          res.on('end',()=>{try{if(res.statusCode!==200)throw new Error();const metrics=JSON.parse(body);if(!['live','stale','offline'].includes(metrics.connection))throw new Error();resolve(metrics);}catch(e){reject(e);}});
        });
        req.on('error',reject);
        req.setTimeout(15000,()=>req.destroy(new Error('Metrics timeout')));
      } catch (e) { reject(e); }
    });
    for (const endpoint of endpoints) {
      try { return await fetchMetrics(endpoint); } catch {}
    }
    return offline('等待 Antigrative Dashboard 重新连接');
  });
};
