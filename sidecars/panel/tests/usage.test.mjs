import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {UsageLedger,DesktopUsage,usageRecords,dateKey} from '../usage.mjs';
import {canonicalModelName,modelEffortTier} from '../pricing.mjs';
import {MetricsStore} from '../store.mjs';
import {parseSummariesProto,readLocalSummaries} from '../local-summaries.mjs';
const scope=s=>createHash('sha256').update(s).digest('hex'),account=scope('account A');
const id='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222';
const raw=(options={})=>({trajectory:{steps:[{type:'CORTEX_STEP_TYPE_PLANNER_RESPONSE',metadata:{createdAt:'2026-10-10T16:05:00Z',...options.metadata}}],generatorMetadata:[{stepIndices:[0],chatModel:{modelDisplayName:options.model||'Gemini 3.8',...(options.start?{chatStartMetadata:{createdAt:options.start}}:{}),usage:{apiProvider:'API_PROVIDER_GOOGLE_GEMINI',responseId:'private-request-id',inputTokens:'100',cacheReadTokens:'900',cacheWriteTokens:'20',outputTokens:'80',thinkingOutputTokens:'30',...options.usage}}}]}});
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'ag-usage-'));t.after(()=>rm(dir,{recursive:true,force:true}));return new UsageLedger(dir);}
test('usage survives restart, upserts, and deduplicates across conversations',async t=>{
 const ledger=await fixture(t);await Promise.all([ledger.ingest(account,id,raw()),ledger.ingest(account,id,raw())]);
 await ledger.ingest(account,other,raw());let summary=await new UsageLedger(ledger.directory).summary(account,Date.parse('2026-10-11T02:00:00Z'));
 assert.equal(summary.totalTokens,1100);assert.equal(summary.requests,1);assert.equal(summary.todayTokens,1100);
 await ledger.ingest(account,id,raw({usage:{outputTokens:100}}));summary=await ledger.summary(account);assert.equal(summary.totalTokens,1120);
 await ledger.ingest(account,id,{trajectory:{generatorMetadata:[]}});assert.equal((await ledger.summary(account)).totalTokens,1120);
 const content=await readFile(ledger.file(account,id),'utf8');assert.equal(content.includes('private-request-id'),false);assert.equal(content.includes(id),false);
 assert.equal((await ledger.summary(scope('other'))).totalTokens,0);assert.throws(()=>ledger.file(account,'../escape'));
});
test('request time wins, planner-created is fallback, and unknown dates stay out of today',async t=>{
 assert.equal(dateKey(Date.parse('2026-10-10T16:05:00Z')),'2026-10-11');
 assert.equal(usageRecords(raw(),id)[0].timeBasis,'planner-created');
 const start=usageRecords(raw({start:'2026-10-10T15:59:59Z'}),id)[0];assert.equal(dateKey(start.at),'2026-10-10');assert.equal(start.timeBasis,'request-start');
 const ledger=await fixture(t);await ledger.ingest(account,id,raw({metadata:{createdAt:undefined}}));
 const summary=await ledger.summary(account,Date.parse('2026-10-11T02:00:00Z'));assert.equal(summary.unknownTokens,1100);assert.equal(summary.unknownRequests,1);assert.equal(summary.todayTokens,0);assert.equal(summary.totalTokens,1100);
 await ledger.ingest(account,id,raw());assert.equal((await ledger.summary(account)).unknownRequests,0);
});
test('thinking is included once, anomalous TPS is irrelevant, partial fields do not destroy known counts',async t=>{
 const r=usageRecords(raw(),id)[0];assert.equal(r.output,80);assert.equal(r.uncached+r.cacheRead+r.cacheWrite+r.output,1100);
 const ledger=await fixture(t);await ledger.ingest(account,id,raw());await ledger.ingest(account,id,raw({usage:{outputTokens:'invalid'}}));
 const summary=await ledger.summary(account);assert.equal(summary.totalTokens,1100);assert.equal(summary.partialRequests,1);
 const invalid=raw({usage:{inputTokens:'bad',cacheReadTokens:'bad',outputTokens:'50'}});assert.equal(usageRecords(invalid,id)[0].partial,true);
});
test('weekly/monthly buckets use the configured calendar, unreadable records are reported',async t=>{
 const ledger=await fixture(t);await ledger.ingest(account,id,raw({start:'2026-09-30T16:00:00Z'}));
 await ledger.ingest(account,other,raw({usage:{responseId:'request-two'},start:'2026-10-11T00:00:00Z'}));
 let summary=await ledger.summary(account,Date.parse('2026-10-11T08:00:00Z'));assert.equal(summary.monthTokens,2200);assert.equal(summary.weekTokens,1100);
 await writeFile(ledger.file(account,other),'{broken');summary=await new UsageLedger(ledger.directory).summary(account);assert.equal(summary.unreadableFiles,1);
});
test('backfill refreshes changed trajectories and isolates an account change in flight',async t=>{
 const ledger=await fixture(t);let calls=0,release;const store={identity:account,epoch:1,listConversations:async()=>[{id,modifiedAt:'one',status:'DONE'}],client:{trajectory:async()=>{calls++;return raw();}}};
 const tracker=new DesktopUsage(store,ledger);await tracker.sync();await tracker.sync();assert.equal(calls,1);assert.equal((await tracker.snapshot()).totalTokens,1100);
 store.listConversations=async()=>[{id:other,modifiedAt:'two',status:'DONE'}];store.client.trajectory=()=>new Promise(r=>{release=r;});
 const pending=tracker.sync();await new Promise(r=>setImmediate(r));store.identity=scope('B');store.epoch++;release(raw());await pending;
 assert.equal((await ledger.summary(store.identity)).totalTokens,0);
});
test('MetricsStore forwards authenticated raw records and preserves live speed on ledger failure',async()=>{
 const history={load:async()=>null,save:async()=>null};let scopeSeen=null;
 const client={discover:async()=>({pid:1}),call:async name=>name==='GetUserStatus'?{userStatus:{email:'fixture@example.test'}}:{},trajectory:async()=>raw()};
 const store=new MetricsStore(client,{history,onTrajectory:async s=>{scopeSeen=s;throw Error('disk unavailable');}});const result=await store.snapshot({conversationId:id});
 assert.equal(scopeSeen,scope('fixture@example.test'));assert.equal(store.usagePersistenceError,true);assert.equal(result.speed.counts.input,100);
 store.onTrajectory=async()=>{};await store.snapshot({conversationId:id,force:true});assert.equal(store.usagePersistenceError,false);
});
test('IDE usage keeps a separate ledger and source across collector restarts',async t=>{
 const desktop=await fixture(t),ide=new UsageLedger(join(desktop.directory,'ide'),{source:'ide-local'});
 const store={identity:account,epoch:1,listConversations:async()=>[{id,modifiedAt:'one',status:'DONE'}],client:{trajectory:async()=>raw()}};
 const tracker=new DesktopUsage(store,ide);await tracker.sync();assert.equal((await tracker.snapshot()).source,'ide-local');assert.equal((await tracker.snapshot()).totalTokens,1100);
 assert.equal((await desktop.summary(account)).totalTokens,0);
 const restarted=new DesktopUsage(store,new UsageLedger(ide.directory,{source:'ide-local'}));await restarted.sync();assert.equal((await restarted.snapshot()).totalTokens,1100);assert.equal((await restarted.snapshot()).requests,1);
});

test('local summaries proto discovers unloaded historical conversations and skips already-synced settled ledgers',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ag-local-sum-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const convDir=join(dir,'conversations');await mkdir(convDir,{recursive:true});
 await writeFile(join(convDir,`${id}.db`),'sqlite');
 await writeFile(join(convDir,`${other}.db`),'sqlite');
 const encodeVarint=n=>{const out=[];let v=BigInt(n);while(v>=0x80n){out.push(Number((v&0x7fn)|0x80n));v>>=7n;}out.push(Number(v));return Buffer.from(out);};
 const encodeBytes=(field,buf)=>Buffer.concat([encodeVarint((field<<3)|2),encodeVarint(buf.length),buf]);
 const encodeUint=(field,val)=>Buffer.concat([encodeVarint((field<<3)|0),encodeVarint(val)]);
 const makeEntry=(cid,title,steps,sec,status=1)=>{
  const ts=Buffer.concat([encodeUint(1,sec),encodeUint(2,500000000)]);
  const sum=Buffer.concat([encodeBytes(1,Buffer.from(title)),encodeUint(2,steps),encodeBytes(3,ts),encodeUint(5,status)]);
  return encodeBytes(1,Buffer.concat([encodeBytes(1,Buffer.from(cid)),encodeBytes(2,sum)]));
 };
 const pb=Buffer.concat([
  makeEntry(id,'Unloaded Session 1',12,1760000000,1),
  makeEntry(other,'Unloaded Session 2',8,1760000100,1),
  makeEntry('33333333-3333-3333-3333-333333333333','Deleted Session',5,1760000200,1),
 ]);
 await writeFile(join(dir,'agyhub_summaries_proto.pb'),pb);
 const parsed=parseSummariesProto(pb);
 assert.equal(Object.keys(parsed).length,3);
 const filtered=await readLocalSummaries(dir);
 assert.deepEqual(Object.keys(filtered).sort(),[id,other].sort());
 assert.equal(filtered[id].stepCount,12);
 assert.equal(filtered[id].summary,'Unloaded Session 1');
 const ledger=await fixture(t);
 await ledger.ingest(account,id,raw());
 assert.equal(await ledger.hasSynced(account,id,'2020-01-01T00:00:00Z'),true);
 assert.equal(await ledger.hasSynced(account,other,'2020-01-01T00:00:00Z'),false);
});

test('usage summary computes equivalent API USD cost per period and respects custom pricing overrides',async t=>{
 const ledger=await fixture(t);
 await ledger.ingest(account,id,raw({model:'Gemini 4 Neon',start:'2026-10-01T02:00:00Z',usage:{responseId:'r1',inputTokens:'1000000',cacheReadTokens:'0',cacheWriteTokens:'0',outputTokens:'1000000'}}));
 await ledger.ingest(account,other,raw({model:'Gemini 4 Neon',start:'2026-10-11T02:00:00Z',usage:{responseId:'r2',inputTokens:'1000000',cacheReadTokens:'2000000',cacheWriteTokens:'0',outputTokens:'0'}}));
 const now=Date.parse('2026-10-11T08:00:00Z');
 const base=await ledger.summary(account,now);
 // Built-in Neon: $3/1M input, $0.15/1M cacheRead, $15/1M output
 // Oct 1: $3 + $15 = $18; Oct 11 (today/week): $3 + 2*$0.15 = $3.30
 assert.equal(base.todayCostUsd,3.3);
 assert.equal(base.weekCostUsd,3.3);
 assert.equal(base.monthCostUsd,21.3);
 assert.equal(base.totalCostUsd,21.3);
 assert.equal(base.days[0].models['Gemini 4 Neon'].costUsd,18);
 assert.equal(base.days[1].models['Gemini 4 Neon'].costUsd,3.3);
 const overridden=await ledger.summary(account,now,{pricingOptions:{overrides:{'Gemini 4 Neon':{input:6,cacheRead:0.3,cacheWrite:0,output:30}}},pricingKey:'custom-1'});
 assert.equal(overridden.todayCostUsd,6.6);
 assert.equal(overridden.totalCostUsd,42.6);
});

test('smart model merging canonicalizes known and future model variants and populates modelAliases',async t=>{
 const flashVariants=['gemini-3.8-flash-control','Gemini 3.8 Flash (High)','gemini-3.8-flash','gemini-3.8-flash-n','Gemini 3.8 Flash (Low)','gemini-3.8-flash-tiered'];
 for(const v of flashVariants)assert.equal(canonicalModelName(v),'Gemini 3.8 Flash');
 for(const v of ['Gemini 4 Argon (High)','Gemini 4 Argon (Medium)','gemini-4-argon-trial','Orchestrator (Argon)'])assert.equal(canonicalModelName(v),'Gemini 4 Argon');
 for(const v of ['Claude Sonnet 5.5 (Medium)','claude-sonnet-5-5-high','claude-sonnet-5-5-medium'])assert.equal(canonicalModelName(v),'Claude Sonnet 5.5');
 // Unlisted future model variants still collapse together cleanly
 assert.equal(canonicalModelName('gemini-5-nova-control'),'Gemini 5 Nova');
 assert.equal(canonicalModelName('Gemini 5 Nova (XHigh)'),'Gemini 5 Nova');
 assert.equal(canonicalModelName('gemini-5-nova-n'),'Gemini 5 Nova');

 const ledger=await fixture(t);
 await ledger.ingest(account,id,raw({model:'gemini-3.8-flash-control',start:'2026-10-11T02:00:00Z',usage:{responseId:'m1',inputTokens:'1000000',cacheReadTokens:'0',cacheWriteTokens:'0',outputTokens:'0'}}));
 await ledger.ingest(account,other,raw({model:'Gemini 3.8 Flash (High)',start:'2026-10-11T03:00:00Z',usage:{responseId:'m2',inputTokens:'1000000',cacheReadTokens:'0',cacheWriteTokens:'0',outputTokens:'0'}}));
 const summary=await ledger.summary(account,Date.parse('2026-10-11T08:00:00Z'));
 assert.equal(summary.modelAliases['gemini-3.8-flash-control'],'Gemini 3.8 Flash');
 assert.equal(summary.modelAliases['Gemini 3.8 Flash (High)'],'Gemini 3.8 Flash');
 assert.equal(summary.modelTiers['gemini-3.8-flash-control'],'default');
 assert.equal(summary.modelTiers['Gemini 3.8 Flash (High)'],'high');
 assert.equal(modelEffortTier('Gemini 4 Hydrogen (XHigh)'),'xhigh');
 assert.equal(modelEffortTier('Orchestrator (Argon)'),'orchestrator');
 assert.equal(modelEffortTier('claude-sonnet-5-5-medium'),'medium');
 assert.equal(modelEffortTier('Gemini 3.8 Flash (Low)'),'low');
 assert.equal(summary.todayCostUsd,1.5);
});
