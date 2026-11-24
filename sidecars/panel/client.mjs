import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { platformPaths } from '../../compat/platform.mjs';
import { discoverProcesses } from './discovery.mjs';
import { TrajectoryJson } from './trajectory-json.mjs';
import { TrajectoryReader } from './trajectory-reader.mjs';
import { readLocalSummaries } from './local-summaries.mjs';

const SERVICE = '/exa.language_server_pb.LanguageServerService/';
export function parseLoopbackAddress(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  let parsed;
  try {
    parsed = new URL(hasScheme ? trimmed : `http://${trimmed}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase())) return null;
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { protocol: hasScheme ? parsed.protocol : null, port };
}
export function serverFromDiscovery(log, processes, env = {}) {
  const list = Array.isArray(processes) ? processes : [processes];
  const standalone = list.filter(p => /--standalone\b/.test(p?.CommandLine || ''));
  const envAddr = parseLoopbackAddress(env?.ANTIGRAVITY_LS_ADDRESS);
  const logPorts = typeof log === 'string'
    ? new Set([...log.matchAll(/listening on random port at (\d+) for HTTP(?:\s|$)/g)].map(m => Number(m[1])))
    : new Set();
  // On Windows, a non-elevated caller sees CommandLine as null/empty for an
  // elevated language_server.exe. Accept such a candidate only when its live
  // listening ports match the sidecar env or current log.
  const hidden = !standalone.length
    ? list.filter(p => p && Number.isSafeInteger(p.ProcessId) && p.ProcessId > 0 && (p.CommandLine === null || p.CommandLine === ''))
    : [];
  const matchedHidden = hidden.filter(p => {
    const pPorts = new Set([p.Ports].flat().map(Number));
    return Boolean(envAddr && pPorts.has(envAddr.port)) || [...logPorts].some(lp => pPorts.has(lp));
  });
  const rows = standalone.length ? standalone : matchedHidden.length ? matchedHidden : hidden;
  if (rows.length !== 1) throw new Error(rows.length ? '检测到多个 Antigravity 实例，请保留一个' : '未找到 Antigravity 桌面后台');
  const ports = new Set([rows[0].Ports].flat().map(Number));
  const envCsrf = typeof env?.ANTIGRAVITY_CSRF_TOKEN === 'string' && env.ANTIGRAVITY_CSRF_TOKEN.trim() ? env.ANTIGRAVITY_CSRF_TOKEN.trim() : null;
  const envMatchesProcess = Boolean(envAddr && ports.has(envAddr.port));
  const logPort = typeof log === 'string'
    ? [...log.matchAll(/listening on random port at (\d+) for HTTP(?:\s|$)/g)].reverse().map(m=>Number(m[1])).find(p=>ports.has(p))
    : null;
  const port = logPort || (envMatchesProcess && envAddr.protocol !== 'https:' ? envAddr.port : null);
  if (!port) throw new Error('等待 Antigravity 本地接口启动');
  const cliCsrf = typeof rows[0].CommandLine === 'string' ? rows[0].CommandLine.match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1] : null;
  const csrf = cliCsrf || (envMatchesProcess ? envCsrf : null);
  if (!csrf) throw new Error(rows[0].CommandLine == null || rows[0].CommandLine === '' ? 'Antigravity 正在管理员权限下运行，当前进程无法读取本地凭据' : '当前版本未提供可用的本地检测凭据');
  return {port,csrf,pid:rows[0].ProcessId};
}
export class AntigravityClient {
  constructor({paths=platformPaths,readLog=readFile,processes=discoverProcesses,localSummaries=readLocalSummaries,now=Date.now,onRpc=null,env=process.env}={}) {
    this.paths=paths;this.readLog=readLog;this.processes=processes;this.localSummaries=localSummaries;this.now=now;this.onRpc=onRpc;this.env=env;this.reader=new TrajectoryReader(this);
  }
  server = null;
  discoveredAt = 0;
  discovering = null;
  lastScanAt = -Infinity;
  retryAt = 0;
  discoveryFailures = 0;
  discoveryError = null;

  async discover(force = false) {
    if (!force && this.server && this.now() - this.discoveredAt < 15000) return this.server;
    if (this.discovering) return this.discovering;
    if (!force && this.discoveryError && this.now() < this.retryAt) throw this.discoveryError;
    this.lastScanAt=this.now();
    this.discovering = this.discoverNow().then(server=>{
      this.discoveredAt=this.now();this.discoveryFailures=0;this.discoveryError=null;this.retryAt=0;return server;
    }).catch(error=>{
      this.discoveryError=error;this.discoveryFailures++;
      this.retryAt=this.now()+Math.min(30000,3000*2**Math.min(4,this.discoveryFailures-1));throw error;
    }).finally(() => { this.discovering = null; });
    return this.discovering;
  }

  async discoverNow() {
    this.server=null;
    // A sidecar can outlive a renderer/backend restart. Its injected token may
    // then refer to the previous LS instance; pair the current log port with
    // the current standalone process credential instead of mixing generations.
    const parsed = await this.processes();
    if (!parsed || Array.isArray(parsed) && !parsed.length) throw new Error('请先打开 Antigravity');
    // Credentials stay in process memory. They are never logged, persisted, or
    // returned to a browser; all calls go exclusively to 127.0.0.1.
    let foundLog=false,lastError=null;
    const paths=this.paths();
    for(const file of paths.logCandidates||[paths.log]) {
      try {
        const log=await this.readLog(file,'utf8');foundLog=true;
        this.server=serverFromDiscovery(log,parsed,this.env);break;
      } catch(error) {
        if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')lastError=error;
      }
    }
    if(!this.server&&!foundLog&&this.env?.ANTIGRAVITY_LS_ADDRESS) {
      try { this.server=serverFromDiscovery('',parsed,this.env); }
      catch {}
    }
    if(!this.server)throw lastError||new Error(foundLog?'等待 Antigravity 本地接口启动':'未找到 Antigravity 语言服务日志，请检查日志路径');
    this.discoveredAt = this.now();
    return this.server;
  }

  async call(method, body = {}, retry = true) {
    const server = await this.discover();
    try {
      return await new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const projection=['GetCascadeTrajectory','GetCascadeTrajectorySteps','GetCascadeTrajectoryGeneratorMetadata'].includes(method);
        const started=this.now();
        // A rejected stream destroys its socket. Do not leave that socket in
        // the shared agent where an immediate quota refresh could reuse it.
        const req = request({ hostname: '127.0.0.1', port: server.port, method: 'POST', path: SERVICE + method, ...(projection?{agent:false}:{}),
          headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'x-codeium-csrf-token': server.csrf, 'Content-Length': Buffer.byteLength(data) } }, res => {
          const projected=projection?new TrajectoryJson():null;
          let text = '',bytes=0,failed=false;
          const fail=error=>{if(failed)return;failed=true;reject(error);req.destroy();};
          res.setEncoding('utf8');
          res.on('error',error=>{if(!failed){failed=true;reject(error);}});
          res.on('data', chunk => {
            if(failed)return;bytes+=Buffer.byteLength(chunk);
            // Projected streams have no whole-response byte ceiling. The
            // retained statistics budget, parser depth and time bound work.
            if(!(projected&&res.statusCode===200)&&bytes>32*1024*1024){fail(new Error('接口响应超过采集上限'));return;}
            try { if(projected&&res.statusCode===200)projected.write(chunk);else text+=chunk; }
            catch(error){fail(error);}
          });
          res.on('end', () => {
            if(failed)return;
            if (res.statusCode !== 200) return reject(Object.assign(new Error(`Antigravity 接口 ${method} 返回 ${res.statusCode}`),{status:res.statusCode}));
            try {
              const value=projected?projected.end():JSON.parse(text);
              try{this.onRpc?.({method,bytes,retainedBytes:projected?.retained??Buffer.byteLength(text),ms:this.now()-started});}catch{}
              if(method==='GetAllCascadeTrajectories'&&!this.profile&&this.localSummaries){
                Promise.resolve(this.localSummaries()).then(local=>{
                  if(local&&typeof local==='object')value.trajectorySummaries={...local,...(value.trajectorySummaries||{})};
                  resolve(value);
                }).catch(()=>resolve(value));
                return;
              }
              resolve(value);
            }
            catch(error) { reject(projected?error:new Error('Antigravity 接口返回了无法解析的数据')); }
          });
        });
        req.on('error', reject);
        const failTimeout=()=>{const err=new Error('Antigravity 本地接口超时');reject(err);req.destroy();};
        req.setTimeout(12000, failTimeout);
        // Bound wall time as well as idle time for slow large streams.
        const deadline=setTimeout(failTimeout,30000);deadline.unref();
        req.once('close',()=>clearTimeout(deadline));
        req.end(data);
      });
    } catch (error) {
      // A missing historical cascade, busy API or malformed response does not
      // prove the process/credential changed. Do not launch CIM scans for it.
      const endpointLost=[401,403].includes(error.status)||['ECONNREFUSED','ECONNRESET','EPIPE','ENOTCONN'].includes(error.code);
      if(!endpointLost)throw error;
      // A late failure from an old endpoint cannot invalidate a newer one.
      if(this.server===server){
        this.server=null;this.discoveryError=error;
        this.retryAt=Math.max(this.retryAt,this.lastScanAt+3000);
      }
      if(retry){await this.discover();return this.call(method,body,false);}
      throw error;
    }
  }

  resetTrajectories(){this.reader.reset();}
  trajectory(id,options){return this.reader.read(id,options);}
}
