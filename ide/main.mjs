import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SidecarOwner} from '../compat/sidecar-owner.mjs';
import {RuntimeUi,makeRendererSource} from '../compat/runtime-ui.mjs';
import {PreferencesStore} from '../compat/preferences.mjs';
import {MetricsStore} from '../sidecars/panel/store.mjs';
import {SessionHistory} from '../sidecars/panel/history.mjs';
import {DesktopUsage as LocalUsage,UsageLedger} from '../sidecars/panel/usage.mjs';
import {QuotaEstimator} from '../sidecars/panel/quota-estimate.mjs';
import {PricingStore} from '../sidecars/panel/pricing.mjs';
import {IdeClient} from './client.mjs';
import {ideTargets} from './runtime.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const profile=process.env.AG_PULSE_IDE_PROFILE;
if(!profile)throw Error('IDE profile is required');
const data=process.env.AG_PULSE_IDE_DATA||join(profile,'User','globalStorage','you-should-know-me.antigrative-dashboard-ide');
let debugPort=0;
const client=new IdeClient({profile,debugPort:()=>debugPort});
const store=new MetricsStore(client,{history:new SessionHistory(join(data,'history-v1'))});
const usage=new LocalUsage(store,new UsageLedger(join(data,'usage-v1'),{source:'ide-local'}));
const quotaEstimator=new QuotaEstimator(join(data,'quota-calibration-v1'));
const pricingStore=new PricingStore(join(data,'pricing-config.json'));
store.onTrajectory=(scope,id,raw)=>usage.ingest(scope,id,raw);
const preferences=new PreferencesStore({file:join(data,'preferences.json')});
const files=await Promise.all(['compat/i18n.cjs','compat/inline-widget.cjs','compat/theme.cjs','ide/surface.cjs','compat/usage-ui.cjs'].map(f=>readFile(join(root,f),'utf8')));
const extract=s=>s.slice(s.indexOf('module.exports = ')+17).trim().replace(/;$/,'');
const ownership=new SidecarOwner(data);
if(!await ownership.claim())process.exit(0);
const usageSource=`window.__agPulseUsageFactory=(${extract(files[4])});`;
const owner=ownership.token,source=makeRendererSource(...files.slice(0,3),owner,ownership.startedAt,usageSource);
const adapter=`window.__agPulseSurface=(${extract(files[3])})();`;
// Each workbench has its own bridge request ID and DOM conversation ID. Empty
// composers request account quota only; no most-recent-conversation fallback.
const snapshot=async(input,{signal=null}={})=>{
  let value;
  if(input.conversationId)value=await store.snapshot({...input,signal});
  else{
    try{
      const server=await client.discover();
      if(server.pid!==store.serverPid){store.epoch++;store.identity=null;store.quota=null;store.quotaAt=0;store.sessions.clear();store.serverPid=server.pid;}
      await store.refreshQuota(input.force);
      value={connection:'live',speed:null,groups:store.quota||[],quotaUpdatedAt:new Date(store.quotaAt).toISOString()};
    }catch{value={connection:'offline',speed:null,groups:[],error:'IDE local API unavailable'};}
  }
  if(input.sessionOnly===true){
    return {partial:true,connection:value.connection,error:value.error||null,sessionError:value.sessionError||null,serverTime:value.serverTime||new Date().toISOString(),speed:value.speed,persistenceError:value.persistenceError||null,enabled:true};
  }
  if(input.force)void usage.sync();
  void pricingStore.refreshLive().catch(()=>{});
  const [pricingOptions,pricingMeta,prefs]=await Promise.all([
    pricingStore.options().catch(()=>null),
    pricingStore.meta().catch(()=>null),
    preferences.snapshot(),
  ]);
  const pricingKey=`${pricingMeta?.liveFetchedAt||''}:${JSON.stringify(pricingOptions?.overrides||{})}`;
  const usageSnapshot=await usage.snapshot({pricingOptions,pricingKey});
  const loaded=store.identity?await usage.ledger.records(store.identity).catch(()=>null):null;
  const quotaEstimate=await quotaEstimator.estimate({
    scope:store.identity,groups:value.groups,records:loaded?.records||[],activeModel:value.speed?.model||null,pricingOptions,pricingMeta,
  }).catch(()=>({groups:[],pricingMeta}));
  return {...value,quotaEstimate,usage:usageSnapshot?{...usageSnapshot,quotaEstimate}:null,enabled:true,preferences:prefs};
};
const ui=new RuntimeUi({profile,source:adapter+source,owner,owns:()=>ownership.isOwner(),preferences,pricing:pricingStore,snapshot,dataDir:data,targetOrigin:()=> 'vscode-file://vscode-app',
  discover:async()=>{const result=await ideTargets(profile);debugPort=result.port;await client.discover();return result.targets;}});
await mkdir(data,{recursive:true});
await writeFile(join(data,'runtime.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),mode:'ide'}));
ui.start();
const keepAlive=setInterval(()=>{},60000);
async function stop(){clearInterval(keepAlive);await ui.stop();ownership.stop();process.exit(0);}
ownership.watch(stop);
process.on('message',message=>{if(message?.type==='stop')void stop();});
if(process.connected)process.once('disconnect',()=>{void stop();});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void stop();});
