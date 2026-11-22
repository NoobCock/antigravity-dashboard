import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contextMetrics } from '../context.mjs';
import { trajectoryMetrics } from '../metrics.mjs';
import { SessionHistory, safeMetrics } from '../history.mjs';
import { MetricsStore } from '../store.mjs';

const id='11111111-1111-1111-1111-111111111111',scope='a'.repeat(64);
const raw=(used,max=256000,n=1)=>({trajectory:{cascadeId:id,generatorMetadata:Array.from({length:n},(_,i)=>({chatModel:{modelDisplayName:'Model A',usage:{messageId:String(i),inputTokens:'100',responseOutputTokens:'100',apiProvider:'API_PROVIDER_GOOGLE_GEMINI'},streamingDuration:'2s',chatStartMetadata:{contextWindowMetadata:{estimatedTokensUsed:used,maxContextTokens:max,tokenBreakdown:{prompt:'DO NOT SAVE'}}}}}))}});

test('context is latest request estimate, never accumulated tokens; 0 and over-capacity remain honest',()=>{
  const result=trajectoryMetrics(raw(112000,256000,3));
  assert.equal(result.context.usedTokens,112000);assert.equal(result.context.usedFraction,.4375);
  assert.equal(result.context.remainingTokens,144000);
  assert.equal(contextMetrics({estimatedTokensUsed:0,maxContextTokens:100}).usedFraction,0);
  const over=contextMetrics({estimatedTokensUsed:120,maxContextTokens:100});
  assert.equal(over.usedFraction,1.2);assert.equal(over.remainingTokens,0);
});
test('missing, invalid and unsafe counters cannot produce invented capacities or percentages',()=>{
  for(const estimatedTokensUsed of [-1,Infinity,'wrong',true,{},Number.MAX_SAFE_INTEGER+1])assert.equal(contextMetrics({estimatedTokensUsed,maxContextTokens:100}),null);
  assert.equal(contextMetrics({maxContextTokens:100}),null);
  for(const maxContextTokens of [undefined,0,-1,Infinity,'',true]){
    const value=contextMetrics({estimatedTokensUsed:20,maxContextTokens});
    assert.equal(value.usedTokens,20);assert.equal(value.maxTokens,null);assert.equal(value.usedFraction,null);
  }
});
test('latest model with absent context cannot inherit prior-model capacity',()=>{
  const first=raw(40,100).trajectory.generatorMetadata[0];
  const data=trajectoryMetrics({trajectory:{generatorMetadata:[first,{chatModel:{modelDisplayName:'Model B'}}]}});
  assert.equal(data.context,null);
});
test('only numeric context and sampled model/time enter history; lower usage survives compaction and restart',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ag-context-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const history=new SessionHistory(directory);
  await history.save(scope,id,trajectoryMetrics(raw(80000,100000,3)));
  await history.save(scope,id,trajectoryMetrics(raw(20000,100000,1)));
  const restored=await new SessionHistory(directory).load(scope,id);
  assert.equal(restored.metrics.context.usedTokens,20000);assert.equal(restored.metrics.requests,3);
  const text=await readFile(history.file(scope,id),'utf8');assert.ok(!text.includes('DO NOT SAVE'));assert.ok(!text.includes('tokenBreakdown'));
  const clean=safeMetrics({...trajectoryMetrics(raw(20,100)),context:{usedTokens:20,maxTokens:100,usedFraction:999,credential:'secret'}},id);
  assert.equal(clean.context.usedFraction,.2);assert.ok(!JSON.stringify(clean).includes('secret'));
});
test('context-only records can persist while old v0.4 records without context still load',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ag-context-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const history=new SessionHistory(directory);
  const data=trajectoryMetrics({trajectory:{generatorMetadata:[{chatModel:{chatStartMetadata:{contextWindowMetadata:{estimatedTokensUsed:0,maxContextTokens:100}}}}]}});
  await history.save(scope,id,data);assert.equal((await history.load(scope,id)).metrics.context.usedFraction,0);
  const old=trajectoryMetrics(raw(20));delete old.context;await history.save(scope,id,old);
  assert.equal((await history.load(scope,id)).metrics.tps,50);
});
test('live lower context updates even when cumulative TPS history is protected',async()=>{
  let n=3,used=80;
  const history={load:async()=>null,save:async()=>({savedAt:'2026-10-09T00:00:00Z'})};
  const store=new MetricsStore({trajectory:async()=>raw(used,100,n)},{history});store.identity=scope;
  await store.session(id,true);n=1;used=20;
  const current=await store.session(id,true);
  assert.equal(current.requests,3);assert.equal(current.context.usedFraction,.2);assert.equal(current.contextRestored,false);
});
test('context refreshes immediately after /compact checkpoint before the next turn begins',()=>{
  const baseSteps=[
    {type:'CORTEX_STEP_TYPE_USER_INPUT'},
    {type:'CORTEX_STEP_TYPE_PLANNER_RESPONSE'},
    {type:'CORTEX_STEP_TYPE_USER_INPUT'},
  ];
  const preGen={stepIndices:[1],chatModel:{modelDisplayName:'Gemini 4 Neon (High)',usage:{messageId:'m1',inputTokens:'2300',cacheReadTokens:'500000',responseOutputTokens:'350',apiProvider:'API_PROVIDER_GOOGLE_GEMINI'},streamingDuration:'2s',chatStartMetadata:{startStepIndex:0,checkpointIndex:2,contextWindowMetadata:{estimatedTokensUsed:520507,maxContextTokens:512000,tokenBreakdown:{totalTokens:520507,groups:[{type:'TOKEN_TYPE_SYSTEM_PROMPT',source:'TOKEN_SOURCE_SYSTEM',numTokens:3988},{type:'TOKEN_TYPE_TOOLS',source:'TOKEN_SOURCE_SYSTEM',numTokens:16445},{type:'TOKEN_TYPE_CHAT_MESSAGES',numTokens:500074}]}}}}};
  // While compaction is still running, keep showing pre-compact context.
  const running=trajectoryMetrics({trajectory:{cascadeId:id,steps:[...baseSteps,{type:'CORTEX_STEP_TYPE_CHECKPOINT',status:'CORTEX_STEP_STATUS_RUNNING',metadata:{startedAt:'2026-11-21T13:52:24Z'}}],generatorMetadata:[preGen]}});
  assert.equal(running.context.usedTokens,520507);
  // Once checkpoint completes with modelUsage, refresh immediately to system + summary output tokens.
  const doneWithUsage=trajectoryMetrics({trajectory:{cascadeId:id,steps:[...baseSteps,{type:'CORTEX_STEP_TYPE_CHECKPOINT',status:'CORTEX_STEP_STATUS_DONE',metadata:{startedAt:'2026-11-21T13:52:24Z',completedAt:'2026-11-21T14:03:09Z',modelUsage:{outputTokens:'3949',thinkingOutputTokens:'48',responseOutputTokens:'3901'}},checkpoint:{checkpointIndex:3,includedStepIndexEnd:3,sessionSummary:'x'.repeat(13600)}}],generatorMetadata:[preGen]}});
  assert.equal(doneWithUsage.context.usedTokens,3988+16445+3901);
  assert.equal(doneWithUsage.context.maxTokens,512000);
  assert.equal(doneWithUsage.context.sampledAt,'2026-11-21T14:03:09.000Z');
  // When checkpoint has no modelUsage, fall back to sessionSummary UTF-8 byte estimate.
  const doneWithSummary=trajectoryMetrics({trajectory:{cascadeId:id,steps:[...baseSteps,{type:'CORTEX_STEP_TYPE_CHECKPOINT',status:'CORTEX_STEP_STATUS_DONE',metadata:{completedAt:'2026-11-21T14:03:09Z'},checkpoint:{checkpointIndex:3,includedStepIndexEnd:3,sessionSummary:'摘要'.repeat(1000)}}],generatorMetadata:[preGen]}});
  assert.equal(doneWithSummary.context.usedTokens,3988+16445+Math.ceil(Buffer.byteLength('摘要'.repeat(1000),'utf8')/4));
  // Failed checkpoint must not overwrite pre-compact context.
  const failed=trajectoryMetrics({trajectory:{cascadeId:id,steps:[...baseSteps,{type:'CORTEX_STEP_TYPE_CHECKPOINT',status:'CORTEX_STEP_STATUS_ERROR',metadata:{completedAt:'2026-11-21T14:03:09Z'}}],generatorMetadata:[preGen]}});
  assert.equal(failed.context.usedTokens,520507);
  // Once the next turn produces a generatorMetadata after the checkpoint, use its exact host estimate.
  const nextGen={stepIndices:[5],chatModel:{modelDisplayName:'Gemini 4 Neon (High)',usage:{messageId:'m2',inputTokens:'20917',responseOutputTokens:'319',apiProvider:'API_PROVIDER_GOOGLE_GEMINI'},streamingDuration:'1s',chatStartMetadata:{startStepIndex:3,checkpointIndex:3,contextWindowMetadata:{estimatedTokensUsed:27420,maxContextTokens:512000}}}};
  const nextTurn=trajectoryMetrics({trajectory:{cascadeId:id,steps:[...baseSteps,{type:'CORTEX_STEP_TYPE_CHECKPOINT',status:'CORTEX_STEP_STATUS_DONE',metadata:{completedAt:'2026-11-21T14:03:09Z'},checkpoint:{checkpointIndex:3,includedStepIndexEnd:3,sessionSummary:'x'.repeat(13600)}},{type:'CORTEX_STEP_TYPE_USER_INPUT'},{type:'CORTEX_STEP_TYPE_PLANNER_RESPONSE'}],generatorMetadata:[preGen,nextGen]}});
  assert.equal(nextTurn.context.usedTokens,27420);
});
