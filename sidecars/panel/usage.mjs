// Local usage ledger. Never stores prompts, credentials or raw request IDs.
import {readFile,writeFile,mkdir,rename,readdir,unlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {tokenCount,requestCacheMetrics} from './metrics.mjs';
import {resolveModelPricing,tokenCostUsd,canonicalModelName,modelEffortTier} from './pricing.mjs';
import {platformPaths} from '../../compat/platform.mjs';
const HASH=/^[a-f0-9]{64}$/,GUID=/^[a-f0-9-]{36}$/i;
const hash=value=>createHash('sha256').update(value).digest('hex');
const keys=['uncached','cacheRead','cacheWrite','output'];
const cleanModel=value=>String(value||'Unknown').replace(/[\x00-\x1f\x7f]/g,'').slice(0,120);
const stamp=value=>typeof value==='string'&&/^20\d\d-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const sum=r=>keys.reduce((n,k)=>n+(r[k]??0),0);
const roundUsd=n=>Number((Number.isFinite(n)?n:0).toFixed(4));
const dateFormatters=new Map();
export function dateKey(time,zone='Asia/Shanghai'){
  if(zone==='Asia/Shanghai'&&typeof time==='number'&&Number.isFinite(time)&&time>=946684800000){
    return new Date(time+28800000).toISOString().slice(0,10);
  }
  let fmt=dateFormatters.get(zone);
  if(!fmt){
    fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
    dateFormatters.set(zone,fmt);
  }
  return fmt.format(time);
}
export function usageRecords(raw,conversationId){
  const trajectory=raw?.trajectory||{},rows=new Map(),steps=trajectory.steps||[];
  for(const [index,g] of (trajectory.generatorMetadata||[]).entries()){
    const chat=g.chatModel,u=chat?.usage;if(!u)continue;
    const output=tokenCount(u.outputTokens),cache=requestCacheMetrics(u);
    const uncached=cache?.uncachedTokens??tokenCount(u.inputTokens);
    const read=tokenCount(u.cacheReadTokens)??(u.cacheReadTokens===undefined?0:null);
    const write=tokenCount(u.cacheWriteTokens)??(u.cacheWriteTokens===undefined?0:null);
    // Empty failed-attempt records have no reported consumption.
    if([uncached,read,write,output].every(n=>n===null||n===0))continue;
    const planners=(g.stepIndices||[]).map(i=>Number.isInteger(i)&&i>=0?steps[i]:null).filter(s=>/PLANNER_RESPONSE/.test(String(s?.type||'')));
    const times=planners.map(s=>stamp(s.metadata?.createdAt)).filter(t=>t!==null);
    const at=stamp(chat.chatStartMetadata?.createdAt)??(times.length?Math.min(...times):null);
    const identity=u.responseId?`response:${u.apiProvider||''}:${u.responseId}`:u.messageId?`message:${u.apiProvider||''}:${u.messageId}`:
      `fallback:${conversationId}:${JSON.stringify(g.stepIndices||[index])}:${at??'undated'}`;
    const row={id:hash(identity),at,model:cleanModel(chat.modelDisplayName||chat.responseModel||u.model||chat.model),
      uncached,cacheRead:read,cacheWrite:write,output,partial:uncached===null||read===null||write===null||output===null||!cache&&uncached>0,
      timeBasis:stamp(chat.chatStartMetadata?.createdAt)!==null?'request-start':at!==null?'planner-created':'unknown'};
    const old=rows.get(row.id);
    if(!old||sum(row)>sum(old))rows.set(row.id,row);
  }
  return [...rows.values()];
}
const validRow=r=>r&&HASH.test(r.id)&&typeof r.model==='string'&&r.model.length<=120&&
  (r.at===null||Number.isSafeInteger(r.at)&&r.at>=0)&&keys.every(k=>r[k]===null||Number.isSafeInteger(r[k])&&r[k]>=0);
export class UsageLedger{
  constructor(directory=join(platformPaths().data,'usage-v1'),{timeZone='Asia/Shanghai',source='desktop-local'}={}){this.directory=directory;this.timeZone=timeZone;this.source=source;}
  queue=Promise.resolve();revision=0;cache=null;recordsCache=null;fileCache=new Map();ingestMarks=new Map();
  file(scope,id){if(!HASH.test(scope)||!GUID.test(id))throw Error('Invalid usage scope');return join(this.directory,scope,hash(id.toLowerCase())+'.json');}
  async hasSynced(scope,id,modifiedAt){
    if(!scope||!HASH.test(scope)||!GUID.test(id))return false;
    const modMs=stamp(modifiedAt);if(modMs===null)return false;
    try{
      const file=this.file(scope,id),info=await stat(file);
      return info.size>2&&info.mtimeMs>=modMs;
    }catch{return false;}
  }
  ingest(scope,id,raw){
    if(!scope)return Promise.resolve();
    const rows=usageRecords(raw,id),file=this.file(scope,id);
    const markKey=`${scope}:${id.toLowerCase()}`;
    let totalSum=0,atSum=0,undated=0,partialCount=0;
    for(const r of rows){totalSum+=sum(r);if(r.at===null)undated++;else atSum+=r.at;if(r.partial)partialCount++;}
    const mark=`${rows.length}:${rows[0]?.id||''}:${rows.at(-1)?.id||''}:${totalSum}:${atSum}:${undated}:${partialCount}`;
    if(this.ingestMarks.get(markKey)===mark)return Promise.resolve();
    const pending=this.queue.catch(()=>{}).then(async()=>{
      let previous;try{previous=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Usage ledger cannot be read');}
      if(previous&&(previous.schema!==1||previous.account!==scope||!Array.isArray(previous.records)||!previous.records.every(validRow)))throw Error('Invalid usage ledger');
      const merged=new Map((previous?.records||[]).map(r=>[r.id,r]));
      for(const row of rows){const old=merged.get(row.id),record={...row,at:row.at??old?.at??null,timeBasis:row.at===null&&old?.at!==null&&old?.at!==undefined?old.timeBasis:row.timeBasis};for(const key of keys)record[key]=row[key]??old?.[key]??null;merged.set(row.id,record);}
      const records=[...merged.values()].sort((a,b)=>a.id.localeCompare(b.id));
      if(previous&&JSON.stringify(previous.records)===JSON.stringify(records)){this.ingestMarks.set(markKey,mark);return;}
      await mkdir(join(this.directory,scope),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
      try{await writeFile(temp,JSON.stringify({schema:1,account:scope,records}),{mode:0o600});await rename(temp,file);}
      catch(e){await unlink(temp).catch(()=>{});throw e;}
      try{const info=await stat(file);this.fileCache.set(file,{mtimeMs:info.mtimeMs,ctimeMs:info.ctimeMs,size:info.size,records});}catch{this.fileCache.delete(file);}
      this.ingestMarks.set(markKey,mark);
      this.revision++;this.cache=null;this.recordsCache=null;
    });this.queue=pending;return pending;
  }
  async records(scope){
    await this.queue.catch(()=>{});
    if(!scope||!HASH.test(scope))return null;
    if(this.recordsCache?.scope===scope&&this.recordsCache.revision===this.revision)return this.recordsCache.value;
    const seen=new Map();let unreadable=0;
    const scopeDir=join(this.directory,scope);
    let files=[];try{files=await readdir(scopeDir);}catch(e){if(e.code!=='ENOENT')throw e;}
    const validNames=files.filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
    const activePaths=new Set(validNames.map(name=>join(scopeDir,name)));
    for(const key of this.fileCache.keys())if(key.startsWith(scopeDir)&&!activePaths.has(key))this.fileCache.delete(key);
    const parsedFiles=[];
    for(let i=0;i<validNames.length;i+=32){
      const batch=validNames.slice(i,i+32);
      const loaded=await Promise.all(batch.map(async name=>{
        const full=join(scopeDir,name);
        try{
          const info=await stat(full);
          const cached=this.fileCache.get(full);
          if(cached&&cached.mtimeMs===info.mtimeMs&&cached.ctimeMs===info.ctimeMs&&cached.size===info.size)return cached.records;
          if(info.size>16*1024*1024)throw Error('Ledger too large');
          const text=await readFile(full,'utf8');if(text.length>16*1024*1024)throw Error('Ledger too large');
          const record=JSON.parse(text);if(record.schema!==1||record.account!==scope||!Array.isArray(record.records)||!record.records.every(validRow))throw Error('Invalid ledger');
          this.fileCache.set(full,{mtimeMs:info.mtimeMs,ctimeMs:info.ctimeMs,size:info.size,records:record.records});
          return record.records;
        }catch{this.fileCache.delete(full);return null;}
      }));
      parsedFiles.push(...loaded);
    }
    for(const list of parsedFiles){
      if(!list){unreadable++;continue;}
      for(const r of list){const previous=seen.get(r.id);if(!previous||sum(r)>sum(previous))seen.set(r.id,r);}
    }
    const value={records:[...seen.values()],unreadableFiles:unreadable};
    this.recordsCache={scope,revision:this.revision,value};return value;
  }
  async summary(scope,now=Date.now(),{pricingOptions=null,pricingKey=''}={}){
    await this.queue.catch(()=>{});
    if(!scope||!HASH.test(scope))return null;
    const today=dateKey(now,this.timeZone),cacheKey=`${scope}:${today}:${pricingKey}`;
    if(this.cache?.key===cacheKey&&this.cache.revision===this.revision)return this.cache.value;
    const loaded=await this.records(scope);if(!loaded)return null;
    const daily=new Map(),models=new Set();let unknownTokens=0,unknownCostUsd=0,unknownRequests=0,partialRequests=0;
    for(const r of loaded.records){
      models.add(r.model);if(r.partial)partialRequests++;
      const pricing=resolveModelPricing(r.model,r.at??now,pricingOptions);
      const cost=pricing?tokenCostUsd(r,pricing):0;
      if(r.at===null){unknownTokens+=sum(r);unknownCostUsd+=cost;unknownRequests++;continue;}
      const date=dateKey(r.at,this.timeZone);if(!daily.has(date))daily.set(date,{date,models:{}});
      const day=daily.get(date);day.models[r.model]||={uncached:0,cacheRead:0,cacheWrite:0,output:0,total:0,requests:0,costUsd:0};
      const bucket=day.models[r.model];for(const key of keys)bucket[key]+=r[key]??0;bucket.total+=sum(r);bucket.requests++;bucket.costUsd+=cost;
    }
    const days=[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date));
    for(const day of days)for(const bucket of Object.values(day.models))bucket.costUsd=roundUsd(bucket.costUsd);
    const total=day=>Object.values(day.models).reduce((n,r)=>n+r.total,0);
    const dayCost=day=>Object.values(day.models).reduce((n,r)=>n+(r.costUsd||0),0);
    const sortedModels=[...models].sort();
    const modelAliases=Object.fromEntries(sortedModels.map(m=>[m,canonicalModelName(m,pricingOptions)]));
    const modelTiers=Object.fromEntries(sortedModels.map(m=>[m,modelEffortTier(m)]));
    const value={accountKey:scope,timeZone:this.timeZone,today,days,models:sortedModels,modelAliases,modelTiers,
      todayTokens:days.filter(d=>d.date===today).reduce((n,d)=>n+total(d),0),
      weekTokens:days.filter(d=>d.date>=weekStart(today)&&d.date<=today).reduce((n,d)=>n+total(d),0),
      monthTokens:days.filter(d=>d.date.slice(0,7)===today.slice(0,7)&&d.date<=today).reduce((n,d)=>n+total(d),0),
      totalTokens:days.reduce((n,d)=>n+total(d),0)+unknownTokens,
      todayCostUsd:roundUsd(days.filter(d=>d.date===today).reduce((n,d)=>n+dayCost(d),0)),
      weekCostUsd:roundUsd(days.filter(d=>d.date>=weekStart(today)&&d.date<=today).reduce((n,d)=>n+dayCost(d),0)),
      monthCostUsd:roundUsd(days.filter(d=>d.date.slice(0,7)===today.slice(0,7)&&d.date<=today).reduce((n,d)=>n+dayCost(d),0)),
      totalCostUsd:roundUsd(days.reduce((n,d)=>n+dayCost(d),0)+unknownCostUsd),
      unknownTokens,unknownCostUsd:roundUsd(unknownCostUsd),unknownRequests,partialRequests,unreadableFiles:loaded.unreadableFiles,
      requests:loaded.records.length,firstDate:days[0]?.date||null,updatedAt:new Date(now).toISOString(),source:this.source};
    this.cache={key:cacheKey,revision:this.revision,value};return value;
  }
}
export function weekStart(date){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}

export class DesktopUsage{
  constructor(store,ledger=new UsageLedger()){this.store=store;this.ledger=ledger;this.fingerprints=new Map();}
  syncing=false;lastSync=0;status='waiting';missingConversations=0;scope=null;
  async ingest(scope,id,raw){await this.ledger.ingest(scope,id,raw);}
  sync(){
    if(this.pending)return this.pending;
    const syncScope=this.store.identity,syncEpoch=this.store.epoch;
    this.syncing=true;this.status='syncing';
    this.pending=(async()=>{
      const scope=this.store.identity,epoch=this.store.epoch;if(!scope)return;
      const current=()=>scope===this.store.identity&&epoch===this.store.epoch;
      const conversations=await this.store.listConversations(true);let missing=0;
      for(const c of conversations){
        if(!current())return;
        const key=scope+':'+c.id,mark=c.modifiedAt+':'+c.status;
        if(this.fingerprints.get(key)===mark&&!/RUNNING/.test(c.status||''))continue;
        if(!/RUNNING/.test(c.status||'')&&await this.ledger.hasSynced?.(scope,c.id,c.modifiedAt)){this.fingerprints.set(key,mark);continue;}
        try{const raw=await this.store.client.trajectory(c.id,{summary:{stepCount:c.stepCount,lastModifiedTime:c.modifiedAt,status:c.status,lastUserInputStepIndex:c.lastUserInputStepIndex}});if(!current())return;await this.ingest(scope,c.id,raw);this.fingerprints.set(key,mark);}
        catch{missing++;}
      }
      if(current()){this.missingConversations=missing;this.status=missing?'partial':'ready';this.lastSync=Date.now();}
    })().catch(()=>{if(syncScope===this.store.identity&&syncEpoch===this.store.epoch)this.status='offline';}).finally(()=>{this.lastSync=syncScope===this.store.identity&&syncEpoch===this.store.epoch?Date.now():0;this.syncing=false;this.pending=null;});return this.pending;
  }
  async snapshot(options={}){
    if(!this.store.identity)return null;
    if(this.scope!==this.store.identity){this.scope=this.store.identity;this.lastSync=0;this.status='waiting';this.missingConversations=0;}
    if(Date.now()-this.lastSync>60000)void this.sync();
    const scope=this.store.identity,value=await this.ledger.summary(scope,Date.now(),options);
    return scope===this.store.identity?{...value,syncing:this.syncing,status:this.status,missingConversations:this.missingConversations,persistenceError:this.store.usagePersistenceError===true}:null;
  }
}
