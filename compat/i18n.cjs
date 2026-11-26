// Shared, serializable translations for the inline widget and native panel.
module.exports = function createDashboardI18n(initialLanguage) {
  const dictionary={
    en:{
      panelSpeed:'Speed',panelCache:'Cache',panelContext:'Context',panelDetails:'Metric details',panelUsed:'used',panelSharedQuota:'Shared quota',
      newConversationStats:'Send a message to view stats.',
      subagentStats:'Subagent',accountQuota:'Shared account quota',
      context:'Context window',contextShort:'Ctx',contextUsed:'{used}% used',contextTokens:'{used} / {max}',contextUnknown:'Unavailable',contextUnavailable:'No context stats.',contextBasis:'',contextModel:'Model',contextLimit:'Limit',contextUsage:'Used',contextSaved:'Saved ({time})',contextExceeded:'Exceeds reported capacity.',
      savedStats:'Saved ({time})',saveFailed:'Could not save locally.',
      strip:'Antigrative Dashboard statistics',session:'Session',cache:'Cache hit',cacheTitle:'Token usage',five:'5h quota',week:'Weekly quota',weekShort:'Wk',
      modelTime:'Model time',toolTime:'Tool time',ttft:'Avg TTFT',sessionTps:'Session TPS',latest:'Last request',tokens:'Response / thinking',remaining:'left',
      resetIn:'Resets in',resetTime:'Reset time',group:'Quota group',selectGroup:'Select quota group',refresh:'Refresh',refreshStats:'Refresh',refreshing:'Refreshing…',
      waiting:'Waiting for refresh',connecting:'Connecting…',waitingApp:'Waiting for Antigravity',waitingModel:'Waiting for model',waitingRequest:'No requests yet',
      hover:'Hover for details',autoConnect:'Open app to connect',loadingQuota:'Loading…',unavailableQuota:'Unavailable',
      live:'Connected',stale:'Stale data',offline:'Offline',
      responseBasis:'Response ÷ stream time',allBasis:'Output ÷ stream time',
      missingTime:'{n} req missing timing.',shortSample:'Last request <1s.',running:'Generating…',
      timingUnreliable:'Timing uncertain',ratePending:'Awaiting recalculation',excludedTime:'{n} anomalous timing excluded.',rateWarning:'{n} short/fast samples included.',rateWarningOnly:'{n} short/fast samples included.',rateReasons:'{reasons}',rateReasonCount:'{reason}: {n}',rateUsageRetained:'Token and cache counts retained.',legacyRate:'Reopen while connected to recalculate TPS.',
      reasonToken:'Token scope mismatch',reasonDuplicate:'Conflicting records',reasonRetry:'Retry scope uncertain',reasonTool:'Short tool window',reasonOutlier:'Short outlier',reasonNonfinite:'Invalid rate',
      sample:'{rounds} turns · {steps} steps · {requests} samples',sampleCount:'{n} samples',rounds:'{rounds} turns, {steps} steps',
      noQuota:'Unavailable.',disabledQuota:'Disabled.',noFraction:'Balance unavailable.',
      sharedQuota:'',quotaSource:'',updated:'Updated {time}',health:'Updated {time}',firstUpdate:'Waiting…',
      cacheRate:'Cache hit',cacheRead:'Cache read',cacheInput:'Total input',cacheMiss:'Uncached',cacheWrite:'Cache write',cacheOutput:'Output',
      cacheBasis:'',cacheMissing:'{n} req missing cache.',cacheUnavailable:'No cache stats.',
      cacheCoverage:'{measured}/{total} req',language:'Language',switchLanguage:'Switch to Chinese',languageSaveFailed:'Save failed.',reconnecting:'Waiting to reconnect',panelUnavailable:'Panel unavailable',invalidData:'Invalid data',
      estApiQuota:'API quota',estRemaining:'Est. left',estWaiting:'Pending',estOpen:'Quota estimate',estPrior:'Prior',
      updateCheck:'Check',updateChecking:'Checking…',updateNow:'Update',updateUpdating:'Updating…',updateAuto:'Auto',updateLatest:'Up to date',updateAvailable:'v{version} available',updateApplied:'Updated to v{version}',updateFailed:'Check failed',updateDev:'Dev',
    },
    'zh-CN':{
      panelSpeed:'速度',panelCache:'缓存',panelContext:'上下文',panelDetails:'统计详情',panelUsed:'已用',panelSharedQuota:'共享额度',
      newConversationStats:'发送消息后显示统计。',
      subagentStats:'子代理',accountQuota:'账号共享额度',
      context:'上下文',contextShort:'上下文',contextUsed:'已用 {used}%',contextTokens:'{used} / {max}',contextUnknown:'不可用',contextUnavailable:'暂无上下文统计。',contextBasis:'',contextModel:'模型',contextLimit:'容量',contextUsage:'已用',contextSaved:'已保存 ({time})',contextExceeded:'超过报告容量。',
      savedStats:'已保存 ({time})',saveFailed:'本地保存失败。',
      strip:'Antigrative Dashboard 状态条',session:'会话统计',cache:'缓存命中',cacheTitle:'Token 用量',five:'5h 额度',week:'周额度',weekShort:'周',
      modelTime:'模型用时',toolTime:'工具用时',ttft:'平均 TTFT',sessionTps:'会话 TPS',latest:'最近请求',tokens:'正文 / 思考',remaining:'剩余',
      resetIn:'重置倒计时',resetTime:'重置时间',group:'额度组',selectGroup:'选择额度组',refresh:'刷新',refreshStats:'刷新',refreshing:'刷新中…',
      waiting:'等待刷新',connecting:'连接中…',waitingApp:'等待 Antigravity',waitingModel:'等待生成',waitingRequest:'尚无请求',hover:'悬停查看详情',autoConnect:'打开应用自动连接',loadingQuota:'读取中…',unavailableQuota:'暂不可用',
      live:'已连接',stale:'历史快照',offline:'未连接',
      responseBasis:'正文 ÷ 流式时长',allBasis:'输出 ÷ 流式时长',
      missingTime:'{n} 次缺少时长。',shortSample:'最近请求 <1s。',running:'生成中…',
      timingUnreliable:'计时异常',ratePending:'等待重算',excludedTime:'已排除 {n} 次异常计时。',rateWarning:'含 {n} 次短时/高速采样。',rateWarningOnly:'含 {n} 次短时/高速采样。',rateReasons:'{reasons}',rateReasonCount:'{reason}：{n}',rateUsageRetained:'Token 与缓存已保留。',legacyRate:'重新打开会话以重算 TPS。',
      reasonToken:'Token 范围不一致',reasonDuplicate:'记录冲突',reasonRetry:'重试范围不明',reasonTool:'工具窗口过短',reasonOutlier:'短时异常高值',reasonNonfinite:'速率无效',
      sample:'{rounds}轮 {steps}步 · {requests} 次采样',sampleCount:'{n} 次采样',rounds:'{rounds}轮 {steps}步',
      noQuota:'暂不可用。',disabledQuota:'已停用。',noFraction:'余额不可用。',sharedQuota:'',quotaSource:'',updated:'{time} 更新',health:'{time} 更新',firstUpdate:'等待更新…',
      cacheRate:'缓存命中',cacheRead:'缓存读取',cacheInput:'总输入',cacheMiss:'未缓存',cacheWrite:'缓存写入',cacheOutput:'输出',cacheBasis:'',cacheMissing:'{n} 次缺少缓存统计。',cacheUnavailable:'暂无缓存统计。',cacheCoverage:'{measured}/{total} 次',
      language:'语言',switchLanguage:'Switch to English',languageSaveFailed:'保存失败。',reconnecting:'等待控件重新连接',panelUnavailable:'面板暂不可用',invalidData:'数据格式无效',
      estApiQuota:'等效额度',estRemaining:'预计剩余',estWaiting:'待校准',estOpen:'剩余额度测算',estPrior:'上周期',
      updateCheck:'检查',updateChecking:'检查中…',updateNow:'更新',updateUpdating:'更新中…',updateAuto:'自动',updateLatest:'已是最新',updateAvailable:'有新版 v{version}',updateApplied:'已更新至 v{version}',updateFailed:'检查失败',updateDev:'开发版',
    },
  };
  let language=initialLanguage==='zh-CN'?'zh-CN':'en';
  const t=(key,args={})=>(dictionary[language][key]??dictionary.en[key]??key).replace(/\{(\w+)\}/g,(_,name)=>String(args[name]??''));
  function countdown(at,now=Date.now(),compact=false){
    const end=Date.parse(at);if(!Number.isFinite(end))return '—';if(end<=now)return t('waiting');
    const left=Math.ceil((end-now)/1000),days=Math.floor(left/86400),hours=Math.floor(left%86400/3600),mins=Math.floor(left%3600/60),secs=left%60,pad=n=>String(n).padStart(2,'0');
    return `${days?`${days}${language==='en'?'d':'天'} `:''}${pad(hours)}:${pad(mins)}${compact&&days?'':`:${pad(secs)}`}`;
  }
  function elapsed(value){
    if(typeof value!=='number'||!Number.isFinite(value))return '—';if(value<60)return `${value.toFixed(2)}${language==='en'?'s':' 秒'}`;
    const whole=Math.round(value),h=Math.floor(whole/3600),m=Math.floor(whole%3600/60),s=whole%60;
    return language==='en'?`${h?`${h}h `:''}${m}m ${s}s`:`${h?`${h}小时`:''}${m}分${s}秒`;
  }
  function resetDate(value){
    const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat(language==='en'?'en-GB':'zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Shanghai'}).format(date):'—';
  }
  function errorMessage(value){
    if(!value)return '';
    const key=Object.keys(dictionary.en).find(key=>dictionary.en[key]===value);
    if(key)return t(key);
    if(language==='zh-CN')return value;
    const errors={
      '请先打开 Antigravity':'Open Antigravity to connect.', '当前采集适配器支持 Windows':'This collector requires Windows.',
      '检测到多个 Antigravity 实例，请保留一个':'Multiple Antigravity instances detected. Keep one open.',
      '未找到 Antigravity 桌面后台':'Antigravity desktop backend was not found.',
      '当前版本未提供可用的本地检测凭据':'Local metrics credentials are unavailable in this version.',
      '等待 Antigravity 本地接口启动':'Waiting for the local Antigravity API.',
      '未找到 Antigravity 语言服务日志，请检查日志路径':'Antigravity language-server log was not found. Check the log path.',
      '会话暂时没有可用统计':'No statistics are available for this conversation yet.',
      '完整会话统计分页暂不可用':'Complete conversation statistics are temporarily unavailable.',
      '会话统计数据超过内存预算':'Conversation statistics exceed the memory budget.',
      '会话统计数据超过采集上限':'Retained conversation statistics exceed the collection budget.',
      '会话统计字段超过采集上限':'A statistics field exceeds the collection budget.',
      '会话统计分页读取超时':'Conversation statistics pagination timed out.',
      '会话统计分页数量无效':'Invalid conversation statistics page count.',
      '会话统计分页格式无效':'Invalid conversation statistics page format.',
      '会话仍在更新，请等待下一次刷新':'The conversation is updating; waiting for the next refresh.',
      '接口响应超过采集上限':'The API response exceeds the collection budget.',
      'Antigravity 接口返回了无法解析的数据':'Antigravity returned an invalid response.',
      'Antigravity 本地接口超时':'The local Antigravity API timed out.',
      '会话标识无效':'Invalid conversation identifier.',
      '等待 Antigrative Dashboard 后台启动':'Waiting for the dashboard background process.',
      '等待 Antigrative Dashboard 重新连接':'Waiting for the dashboard to reconnect.',
      '等待 AG Pulse 后台启动':'Waiting for the dashboard background process.',
      '等待 AG Pulse 重新连接':'Waiting for the dashboard to reconnect.',
    };
    if(errors[value])return errors[value];
    const match=String(value).match(/^Antigravity 接口 (\w+) 返回 (\d+)$/);
    return match?`Antigravity ${match[1]} returned HTTP ${match[2]}.`:'Statistics are temporarily unavailable.';
  }
  function connectPreferences({read,write,cache=()=>{},changed=()=>{}}) {
    let epoch=0,writes=0,revision=-1,disposed=false,error=false,queue=Promise.resolve();
    const valid=value=>value==='en'||value==='zh-CN';
    const notify=()=>{if(!disposed)changed();};
    const remember=()=>{try{cache(language);}catch{}};
    const check=value=>{if(!value||value.error||!Object.hasOwn(value,'language')||value.language!==null&&!valid(value.language))throw new Error('Invalid preference response');return value;};
    function sync(value) {
      if(disposed||writes)return;
      try {
        check(value);const next=Number.isSafeInteger(value.revision)?value.revision:0;
        if(next<revision)return;
        if(error&&epoch>0&&value.language!==language)return; // retain an unsaved choice and its warning
        if(value.language===null&&epoch===0&&valid(initialLanguage)){void choose(initialLanguage);return;}
        revision=next;error=false;
        if(valid(value.language)&&language!==value.language){language=value.language;remember();}
        notify();
      } catch {error=true;notify();}
    }
    function choose(value) {
      if(disposed||!valid(value))return Promise.resolve();
      const choice=++epoch;language=value;writes++;error=false;remember();notify();
      const pending=queue.then(async()=>{
        try {
          const saved=check(await write({language:value}));
          if(saved.language!==value)throw new Error('Preference acknowledgement differs');
          revision=Math.max(revision,Number.isSafeInteger(saved.revision)?saved.revision:0);
          if(choice===epoch)error=false;
        } catch {if(choice===epoch)error=true;}
        finally {writes--;notify();}
      });
      queue=pending;return pending;
    }
    const ready=(async()=>{
      const started=epoch;
      try {
        const saved=check(await read());
        if(disposed||epoch!==started)return;
        if(saved.language===null&&valid(initialLanguage))await choose(initialLanguage); // migrate an existing browser choice once
        else sync(saved);
      }catch{if(!disposed&&epoch===started){error=true;notify();}}
    })();
    return {ready,sync,choose,toggle:()=>choose(language==='en'?'zh-CN':'en'),get error(){return error;},get pending(){return writes>0;},dispose(){disposed=true;}};
  }
  function rateNote(speed) {
    if (!speed) return t('waitingRequest');
    if (speed.latestRateStatus === 'legacy') return t('ratePending');
    return t(speed.rateBasis==='all-output'?'allBasis':'responseBasis');
  }
  return {t,rateNote,countdown,elapsed,resetDate,errorMessage,connectPreferences,get language(){return language;},setLanguage(value){language=value==='zh-CN'?'zh-CN':'en';},toggle(){language=language==='en'?'zh-CN':'en';return language;}};
};
