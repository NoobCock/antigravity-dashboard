// Statistics-only acquisition. Host schemas accept offsets, not page sizes.
// Cached immutable prefixes are local numeric/structural projections only.
const settled=s=>/IDLE|DONE|COMPLETED|CANCELLED|CANCELED|STOPPED|FAILED|ERROR/.test(String(s||''));
const settledStep=s=>/DONE|COMPLETED|CLEARED|CANCELLED|CANCELED|STOPPED|FAILED|ERROR|SKIPPED/i.test(String(s||''));
const pendingCheckpoint=s=>/CHECKPOINT/i.test(String(s?.type||''))&&(s?.status?!settledStep(s.status):Boolean((s?.metadata?.startedAt||s?.metadata?.createdAt)&&!s?.metadata?.completedAt));
const pendingPlanner=s=>/PLANNER_RESPONSE/i.test(String(s?.type||''))&&/RUNNING|IN_PROGRESS|GENERATING|STREAMING|PENDING/i.test(String(s?.status||''))&&!s?.metadata?.finishedGeneratingAt&&!s?.metadata?.completedAt;
const pendingTool=s=>!/PLANNER_RESPONSE/i.test(String(s?.type||''))&&!settledStep(s?.status)&&Boolean(s?.metadata&&(s.metadata.startedAt||s.metadata.createdAt)&&!s.metadata.completedAt&&
 (/SEARCH_WEB|BROWSE|RUN_COMMAND|COMMAND|READ|WRITE|EDIT|CODE_ACTION|TOOL|MCP|LIST|GREP|VIEW|FIND|TERMINAL/i.test(String(s.type||''))||s.metadata.toolCall));
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable=()=>new Error('后台已重新连接，请等待刷新');
export class TrajectoryReader {
 // Serialized statistics budget, not transcript/response size. Local resource
 // experiments cover 1K/8K/32K records; 8 MiB bounds retained objects well below
 // the 32K-record case (~100 MiB extra heap). See docs/LONG_CONVERSATIONS.md.
 constructor(client,{budgetBytes=8*1024*1024,idleRecheckMs=10000}={}){this.client=client;this.budgetBytes=budgetBytes;this.idleRecheckMs=idleRecheckMs;}
 entries=new Map();epoch=0;endpoint=null;summaries=null;summaryAt=-Infinity;summaryPending=null;cachedBytes=0;
 reset(){this.epoch++;this.entries.clear();this.summaries=null;this.summaryAt=-Infinity;this.summaryPending=null;this.cachedBytes=0;}
 trim(keep){for(const [key,e]of this.entries){if(this.cachedBytes<=this.budgetBytes)break;if(key===keep||e.pending)continue;this.cachedBytes-=e.bytes;this.entries.delete(key);}}
 async summary(id,provided,force){
  if(provided)return provided;
  const summaryTtl = !settled(this.summaries?.[id]?.status) ? 450 : 1800;
  if(force||!this.summaries||this.client.now()-this.summaryAt>=summaryTtl){
   if(!this.summaryPending){const epoch=this.epoch;
    const pending=this.client.call('GetAllCascadeTrajectories').then(r=>{
     if(epoch!==this.epoch)throw unavailable();this.summaries=r.trajectorySummaries||{};this.summaryAt=this.client.now();
    }).finally(()=>{if(this.summaryPending===pending)this.summaryPending=null;});this.summaryPending=pending;
   }
   await this.summaryPending;
  }
  const s=this.summaries[id];
  if(!s){
   if(GUID.test(id)&&this.client?.localSummaries&&this.client?.server)return {status:'CASCADE_RUN_STATUS_IDLE'};
   throw new Error('会话暂时没有可用统计');
  }
  return s;
 }
 async read(id,{summary:provided,force=false,signal=null}={}){
  if(signal?.aborted){const err=new Error('请求已取消');err.name='AbortError';throw err;}
  const endpoint=await this.client.discover();
  if(!this.endpoint||['pid','port','csrf'].some(k=>this.endpoint[k]!==endpoint[k])){this.reset();this.endpoint=endpoint;}
  let entry=this.entries.get(id);
  const attachWaiter=(target,sig)=>{
    target.waiters=(target.waiters||0)+1;
    let released=false;
    const release=()=>{
      if(released)return;released=true;
      target.waiters=Math.max(0,(target.waiters||1)-1);
      if(target.waiters===0&&target.controller&&!target.controller.signal.aborted)target.controller.abort();
    };
    if(!sig)return target.pending.finally(release);
    return new Promise((resolve,reject)=>{
      const onAbort=()=>{release();const err=new Error('请求已取消');err.name='AbortError';reject(err);};
      if(sig.aborted){onAbort();return;}
      sig.addEventListener('abort',onAbort,{once:true});
      target.pending.then(v=>{sig.removeEventListener('abort',onAbort);release();resolve(v);},e=>{sig.removeEventListener('abort',onAbort);release();reject(e);});
    });
  };
  if(entry?.pending)return attachWaiter(entry,signal);
  entry||={data:null,bytes:0};this.entries.set(id,entry);
  const epoch=this.epoch,current=()=>epoch===this.epoch&&this.entries.get(id)===entry;
  const controller=new AbortController();
  entry.controller=controller;entry.waiters=0;
  const assertCurrent=()=>{
    if(controller.signal.aborted){const err=new Error('请求已取消');err.name='AbortError';throw err;}
    if(!current())throw unavailable();
  };
  entry.pending=(async()=>{
   const summary=await this.summary(id,provided,force);assertCurrent();
   const count=summary.stepCount===undefined?null:Number(summary.stepCount);if(count!==null&&(!Number.isSafeInteger(count)||count<0))throw new Error('会话统计分页数量无效');
   const mark=JSON.stringify([count,summary.lastModifiedTime,summary.status,summary.lastUserInputStepIndex]);
   const old=entry.data;
   const same=old&&entry.mark===mark;
   const hasPendingCheckpoint=Boolean(old?.trajectory?.steps?.some(pendingCheckpoint));
   if(!force&&same&&!hasPendingCheckpoint&&settled(summary.status)&&summary.lastModifiedTime&&this.client.now()-entry.verifiedAt<this.idleRecheckMs){this.entries.delete(id);this.entries.set(id,entry);return old;}
   // A changed settled history with no append may have been edited/compacted.
   const incremental=old&&!force&&count!==null&&count>=old.trajectory.steps.length&&(count>old.trajectory.steps.length||!settled(entry.summary?.status)||same);
   let stepOffset=0,metadataOffset=0;
   if(incremental){
    const lastInput=old.trajectory.steps.findLastIndex(s=>/USER_INPUT/.test(String(s?.type||'')));
    // The submitted input is immutable within a running turn. Start after it
    // so a large corpus is not downloaded on each generation-state refresh.
    stepOffset=lastInput<0?0:lastInput+1;
    const gs=old.trajectory.generatorMetadata;
    if(gs.length&&gs.every(g=>Array.isArray(g.stepIndices)&&g.stepIndices.length&&g.stepIndices.every(i=>Number.isInteger(i)&&i>=0))){
     metadataOffset=Math.max(0,gs.length-1);
     const associated=(gs.at(-1)?.stepIndices||[]).filter(i=>Number.isInteger(i)&&i>=0&&i<old.trajectory.steps.length&&!/USER_INPUT/.test(String(old.trajectory.steps[i]?.type||'')));
     stepOffset=associated.length?Math.min(...associated):old.trajectory.steps.length;
    }
    // Background tools, active planners and in-flight compactions can finish after
    // newer model requests or after summary.status becomes idle. Refresh from the earliest one.
    const pendingStep=old.trajectory.steps.findIndex(s=>pendingCheckpoint(s)||pendingPlanner(s)||pendingTool(s));
    if(pendingStep>=0)stepOffset=Math.min(stepOffset,pendingStep);
    if(gs.some(g=>!Array.isArray(g.stepIndices)||!g.stepIndices.length))metadataOffset=0;
   }
   const steps=incremental?old.trajectory.steps.slice(0,stepOffset):[];
   const generators=incremental?old.trajectory.generatorMetadata.slice(0,metadataOffset):[];
   let bytes=Buffer.byteLength(JSON.stringify({steps,generatorMetadata:generators}));const deadline=this.client.now()+30000;
   const append=(target,items)=>{
    for(const item of items){bytes+=Buffer.byteLength(JSON.stringify(item))+1;if(bytes>this.budgetBytes)throw new Error('会话统计数据超过内存预算');target.push(item);}
   };
   const check=()=>{assertCurrent();if(this.client.now()>deadline)throw new Error('会话统计分页读取超时');};
   const fetchSteps=async()=>{
    while(count===null||steps.length<count){
     check();const page=await this.client.call('GetCascadeTrajectorySteps',{cascadeId:id,stepOffset:steps.length,trajectoryVerbosity:3},true,controller.signal);check();
     const items=page.steps||[];if(!Array.isArray(items))throw new Error('会话统计分页格式无效');
     if(!items.length){if(count===null)break;throw new Error('完整会话统计分页暂不可用');}append(steps,items);
    }
   };
   const fetchGenerators=async()=>{
    for(;;){
     check();const page=await this.client.call('GetCascadeTrajectoryGeneratorMetadata',{cascadeId:id,generatorMetadataOffset:generators.length,includeMessages:false},true,controller.signal);check();
     const items=page.generatorMetadata||page.generatorMetadatas||[];if(!Array.isArray(items))throw new Error('会话统计分页格式无效');
     if(!items.length)break;append(generators,items);
    }
   };
   // Fetch steps and generator metadata concurrently to halve cold-load latency.
   await Promise.all([fetchSteps(),fetchGenerators()]);
   // A growing host may return newer metadata than the step-count snapshot.
   // Do not cache or persist a mixed/incomplete revision.
   if(generators.some(g=>(g.stepIndices||[]).some(i=>Number.isInteger(i)&&i>=steps.length)))throw new Error('会话仍在更新，请等待下一次刷新');
   const value={trajectory:{cascadeId:id,steps,generatorMetadata:generators},numTotalSteps:steps.length,numTotalGeneratorMetadata:generators.length,status:summary.status};
   assertCurrent();this.cachedBytes-=entry.bytes;entry.bytes=bytes;this.cachedBytes+=bytes;
   entry.data=value;entry.summary=summary;entry.mark=mark;entry.verifiedAt=this.client.now();this.entries.delete(id);this.entries.set(id,entry);
   this.trim(id);
   return value;
  })().finally(()=>{entry.pending=null;entry.controller=null;if(!entry.data&&current())this.entries.delete(id);if(current())this.trim(id);});
  // Suppress unhandled rejection when all waiters abort before settlement.
  entry.pending.catch(()=>{});
  return attachWaiter(entry,signal);
 }
}
