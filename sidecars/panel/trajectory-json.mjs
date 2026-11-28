// Incremental JSON projection for trajectory RPCs. Large prompts, tool results,
// images and executor payloads are validated and skipped, never buffered.
const scalar='scalar',nonempty='nonempty',presence='presence',calls='calls',length='length';
const usage=Object.fromEntries(['inputTokens','outputTokens','responseOutputTokens','thinkingOutputTokens','cacheReadTokens','cacheWriteTokens','apiProvider','responseId','messageId','model'].map(k=>[k,scalar]));
const stepUsage={outputTokens:scalar,responseOutputTokens:scalar,thinkingOutputTokens:scalar};
const duration={seconds:scalar,nanos:scalar};
const breakdownGroup={type:scalar,source:scalar,numTokens:scalar};
const chatModelNode={usage,model:scalar,modelDisplayName:scalar,responseModel:scalar,
 streamingDuration:duration,timeToFirstToken:duration,retryInfos:{'*':{usage:stepUsage}},
 chatStartMetadata:{createdAt:scalar,startStepIndex:scalar,checkpointIndex:scalar,
  contextWindowMetadata:{estimatedTokensUsed:scalar,maxContextTokens:scalar,
   tokenBreakdown:{totalTokens:scalar,groups:{'*':breakdownGroup}}}}};
const generators={'*':{stepIndices:{'*':scalar},chatModel:chatModelNode}};
const TOOL_STEP_RE=/SEARCH_WEB|BROWSE|RUN_COMMAND|COMMAND|READ|WRITE|EDIT|CODE_ACTION|TOOL|MCP|LIST|GREP|VIEW|FIND|TERMINAL/i;
const ACTIVE_PLANNER_STATUS_RE=/RUNNING|IN_PROGRESS|GENERATING|STREAMING|PENDING/i;
const DONE_STATUS_RE=/DONE|COMPLETED/i;
const plannerNode={thinking:length,response:nonempty,toolCalls:calls};
const stepNode={type:scalar,status:scalar,metadata:{createdAt:scalar,viewableAt:scalar,finishedGeneratingAt:scalar,startedAt:scalar,completedAt:scalar,toolCall:presence,modelUsage:stepUsage},
 checkpoint:{checkpointIndex:scalar,includedStepIndexStart:scalar,includedStepIndexEnd:scalar,sessionSummary:length},
 plannerResponse:plannerNode};
const steps={'*':stepNode};
const schema={trajectory:{cascadeId:scalar,trajectoryId:scalar,steps,generatorMetadata:generators},steps,
 generatorMetadata:generators,generatorMetadatas:generators,status:scalar,numTotalSteps:scalar,numTotalGeneratorMetadata:scalar};
const DROP=Symbol('discard');
const retainedSize=v=>typeof v==='string'?v.length*2+32:v&&typeof v==='object'?Object.values(v).reduce((s,x)=>s+retainedSize(x),96):32;
function addUtf8Bytes(token,text){
 for(let i=0;i<text.length;i++){
  const code=text.charCodeAt(i);
  if(token.highSurrogate){
   if(code>=0xdc00&&code<=0xdfff){token.byteLength+=4;token.highSurrogate=false;continue;}
   token.byteLength+=3;token.highSurrogate=false;
  }
  if(code<=0x7f)token.byteLength+=1;
  else if(code<=0x7ff)token.byteLength+=2;
  else if(code>=0xd800&&code<=0xdbff)token.highSurrogate=true;
  else token.byteLength+=3;
 }
}
export class TrajectoryJson {
 constructor({maxRetainedBytes=16*1024*1024}={}){this.maxRetainedBytes=maxRetainedBytes;}
 stack=[];token=null;result=undefined;done=false;retained=0;
 fail(){throw new Error('Antigravity 接口返回了无法解析的数据');}
 charge(n){if((this.retained+=n)>this.maxRetainedBytes)throw new Error('会话统计数据超过采集上限');}
 node(){const f=this.stack.at(-1);if(!f)return schema;const key=f.array?'*':f.key;return f.node&&typeof f.node==='object'&&Object.hasOwn(f.node,key)?f.node[key]:undefined;}
 valueAllowed(){const f=this.stack.at(-1);return f?['value','valueOrEnd'].includes(f.expect):!this.done;}
 inCallsSubtree(){for(let i=this.stack.length-1;i>=0;i--){if(this.stack[i].node===calls)return this.stack[i];if(this.stack[i].node===stepNode)return null;}return null;}
 finishValue(value){
  const f=this.stack.at(-1);
  if(!f){if(this.done)this.fail();this.result=value;this.done=true;return;}
  if(!['value','valueOrEnd'].includes(f.expect))this.fail();
  if(value!==DROP&&f.out){this.charge(32);if(f.array)f.out.push(value);else Object.defineProperty(f.out,f.key,{value,writable:true,enumerable:true,configurable:true});}
  f.count++;f.expect='commaOrEnd';f.key=null;
 }
 punctuation(c){
  const f=this.stack.at(-1);
  if(c==='{'||c==='['){
   if(!this.valueAllowed()||this.stack.length>=64)this.fail();const node=this.node(),array=c==='[';
   const out=typeof node==='object'?(array?[]:{}):null;if(out)this.charge(64);
   this.stack.push({node,array,out,count:0,streamBytes:0,key:null,expect:array?'valueOrEnd':'keyOrEnd'});return;
  }
  if(c==='}'||c===']'){
   if(!f||f.array!==(c===']')||!['commaOrEnd',f.array?'valueOrEnd':'keyOrEnd'].includes(f.expect))this.fail();
   this.stack.pop();
   if(f.node===calls){
    const parent=this.stack.at(-1);
    if(parent?.node===plannerNode)parent.streamBytes+=f.streamBytes;
   }
   if(f.node===plannerNode&&f.out){
    const thinkingBytes=typeof f.out.thinking==='number'?f.out.thinking:0;
    delete f.out.thinking;
    f.out._streamBytes=thinkingBytes+f.streamBytes;
   }
   if(f.node===stepNode&&f.out){
    const typeStr=String(f.out.type||'');
    const isCheckpoint=/CHECKPOINT/i.test(typeStr);
    const isPlanner=/PLANNER_RESPONSE/.test(typeStr);
    const statusStr=String(f.out.status||'');
    const isRunningPlanner=isPlanner&&ACTIVE_PLANNER_STATUS_RE.test(statusStr);
    if(f.out.plannerResponse&&typeof f.out.plannerResponse==='object'){
     const sb=f.out.plannerResponse._streamBytes||0;
     delete f.out.plannerResponse._streamBytes;
     if(isRunningPlanner)f.out.plannerResponse.streamBytes=sb;
    }
    if(!isCheckpoint){
     const meta=f.out.metadata&&typeof f.out.metadata==='object'?f.out.metadata:null;
     const isTool=!isPlanner&&(TOOL_STEP_RE.test(typeStr)||Boolean(meta?.toolCall));
     const keepStatus=isRunningPlanner||(isPlanner&&statusStr&&!DONE_STATUS_RE.test(statusStr)&&!meta?.finishedGeneratingAt)||(isTool&&!meta?.completedAt);
     if(!keepStatus&&Object.hasOwn(f.out,'status')){this.retained=Math.max(0,this.retained-retainedSize(f.out.status));delete f.out.status;}
     if(Object.hasOwn(f.out,'checkpoint')){this.retained=Math.max(0,this.retained-retainedSize(f.out.checkpoint));delete f.out.checkpoint;}
     if(meta){
      if(Object.hasOwn(meta,'modelUsage')){this.retained=Math.max(0,this.retained-retainedSize(meta.modelUsage));delete meta.modelUsage;}
      if(!isPlanner&&!isTool){
       this.retained=Math.max(0,this.retained-retainedSize(meta));delete f.out.metadata;
      }else{
       if(isPlanner){
        if(Object.hasOwn(meta,'startedAt')){this.retained=Math.max(0,this.retained-retainedSize(meta.startedAt));delete meta.startedAt;}
        if(Object.hasOwn(meta,'completedAt')){this.retained=Math.max(0,this.retained-retainedSize(meta.completedAt));delete meta.completedAt;}
       }else{
        if(Object.hasOwn(meta,'viewableAt')){this.retained=Math.max(0,this.retained-retainedSize(meta.viewableAt));delete meta.viewableAt;}
        if(Object.hasOwn(meta,'finishedGeneratingAt')){this.retained=Math.max(0,this.retained-retainedSize(meta.finishedGeneratingAt));delete meta.finishedGeneratingAt;}
        if(meta.startedAt&&Object.hasOwn(meta,'createdAt')){
         this.retained=Math.max(0,this.retained-retainedSize(meta.createdAt));delete meta.createdAt;
        }
       }
       if(!Object.keys(meta).length){this.retained=Math.max(0,this.retained-96);delete f.out.metadata;}
      }
     }
    }
   }
   if(f.node===chatModelNode&&f.out&&Array.isArray(f.out.retryInfos)){
    const attempts=f.out.retryInfos.filter(info=>info?.usage);
    if(attempts.length<=1){
     this.retained=Math.max(0,this.retained-retainedSize(f.out.retryInfos));
     delete f.out.retryInfos;
    }
   }
   this.finishValue(f.node===presence?true:f.node===calls?(f.count?[{}]:[]):f.out||DROP);return;
  }
  if(c===':'){if(!f||f.array||f.expect!=='colon')this.fail();f.expect='value';return;}
  if(c===','){if(!f||f.expect!=='commaOrEnd')this.fail();f.expect=f.array?'value':'key';return;}
  this.fail();
 }
 startString(){
  const f=this.stack.at(-1),key=f&&!f.array&&['key','keyOrEnd'].includes(f.expect);
  if(!key&&!this.valueAllowed())this.fail();
  const node=key?null:this.node();
  const callsFrame=!key?this.inCallsSubtree():null;
  this.token={kind:'string',key,node,callsFrame,buffer:'',byteLength:0,highSurrogate:false,overflow:false,escape:0,hex:'',any:false};
 }
 stringPart(text){
  const t=this.token;if(t.node===nonempty&&/\S/u.test(text)||t.node===presence&&text.length)t.any=true;
  if(t.node===length||t.node===nonempty||t.callsFrame){addUtf8Bytes(t,text);if(t.node===length||t.callsFrame&&!t.node)return;}
  if(t.key||t.node===scalar||typeof t.node==='object'){
   if(t.overflow)return;t.buffer+=text;
   if(t.buffer.length>(t.key?1024:16384)){if(!t.key)throw new Error('会话统计字段超过采集上限');t.buffer='';t.overflow=true;}
  }
 }
 endString(){
  const t=this.token;this.token=null;
  if(t.key){const f=this.stack.at(-1);f.key=t.overflow?null:t.buffer;f.expect='colon';return;}
  const bytes=t.byteLength+(t.highSurrogate?3:0);
  if(t.callsFrame)t.callsFrame.streamBytes+=bytes;
  if(t.node===nonempty){
   const top=this.stack.at(-1);
   if(top?.node===plannerNode)top.streamBytes+=bytes;
  }
  let value=DROP;
  if(t.node===nonempty)value=t.any?'1':'';
  else if(t.node===presence)value=t.any;
  else if(t.node===length)value=bytes;
  else if(t.node===scalar||typeof t.node==='object'){value=t.buffer;this.charge(value.length*2);}
  this.finishValue(value);
 }
 literalEnd(){
  const t=this.token;this.token=null;
  if(!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(t.buffer))this.fail();
  const value=JSON.parse(t.buffer);this.finishValue(t.node?value:DROP);
 }
 write(text){
  let i=0;
  while(i<text.length){
   const t=this.token;
   if(t?.kind==='string'){
    if(t.escape===1){
     const c=text[i++];if(c==='u'){t.escape=2;t.hex='';continue;}
     const decoded={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'}[c];
     if(decoded===undefined)this.fail();this.stringPart(decoded);t.escape=0;continue;
    }
    if(t.escape===2){const c=text[i++];if(!/[0-9a-f]/i.test(c))this.fail();t.hex+=c;if(t.hex.length===4){this.stringPart(String.fromCharCode(parseInt(t.hex,16)));t.escape=0;}continue;}
    const special=/["\\\x00-\x1f]/g;special.lastIndex=i;const hit=special.exec(text),end=hit?hit.index:text.length;
    this.stringPart(text.slice(i,end));i=end;if(!hit)continue;
    const c=text[i++];if(c==='"')this.endString();else if(c==='\\')t.escape=1;else this.fail();continue;
   }
   if(t?.kind==='literal'){
    const start=i;while(i<text.length&&/[a-zA-Z0-9+\-.]/.test(text[i]))i++;
    t.buffer+=text.slice(start,i);if(t.buffer.length>1024)this.fail();if(i<text.length)this.literalEnd();continue;
   }
   const c=text[i++];if(/[ \r\n\t]/.test(c))continue;
   if(c==='"'){this.startString();continue;}
   if('{}[]:,'.includes(c)){this.punctuation(c);continue;}
   if(!this.valueAllowed()||!/[tfn\d-]/.test(c))this.fail();this.token={kind:'literal',node:this.node(),buffer:c};
  }
 }
 end(){if(this.token?.kind==='literal')this.literalEnd();if(this.token||this.stack.length||!this.done||!this.result||typeof this.result!=='object')this.fail();return this.result;}
}
