import { createHash } from 'node:crypto';
import { AntigravityClient } from './client.mjs';
import { quotaMetrics, trajectoryMetrics } from './metrics.mjs';
import { RATE_VERSION } from './rate-quality.mjs';
import { SessionHistory, usableMetrics, shouldKeepSaved } from './history.mjs';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTLED_RUN = /IDLE|DONE|COMPLETED|CANCELLED|CANCELED|STOPPED|FAILED|ERROR/i;
function isSavedFreshForSummary(saved, summary) {
  if (!saved || !summary || !usableMetrics(saved.metrics)) return false;
  if (saved.metrics.rateVersion !== RATE_VERSION || saved.metrics.complete !== true) return false;
  if (!SETTLED_RUN.test(String(summary.status || ''))) return false;
  const count = Number(summary.stepCount);
  if (!Number.isSafeInteger(count) || count < 0 || saved.metrics.steps !== count) return false;
  const modMs = Date.parse(summary.lastModifiedTime || '');
  const savedMs = Date.parse(saved.savedAt || '');
  return Number.isFinite(modMs) && Number.isFinite(savedMs) && savedMs >= modMs + 2000;
}
export class MetricsStore {
  constructor(client = new AntigravityClient(), { history = new SessionHistory(), onTrajectory = null } = {}) { this.client = client; this.history = history; this.onTrajectory=onTrajectory; }
  quota = null;
  quotaAt = 0;
  quotaPending = null;
  identity = null;
  serverPid = null;
  summaries = [];
  summariesAt = 0;
  sessions = new Map();
  persistenceError = null;
  epoch = 0;

  async cachedSession(id) {
    if (!GUID.test(id) || !this.identity) return null;
    const scope = this.identity, epoch = this.epoch;
    const entry = this.sessions.get(id);
    if (usableMetrics(entry?.data)) return { ...entry.data, restoredFromHistory: true, savedAt: entry.savedAt || null };
    const saved = await this.history.load(scope,id);
    if (scope !== this.identity || epoch !== this.epoch) return null;
    if (!saved) return null;
    if (!this.sessions.has(id)) this.sessions.set(id,{data:saved.metrics,savedAt:saved.savedAt,updatedAt:0});
    return {...saved.metrics,restoredFromHistory:true,savedAt:saved.savedAt};
  }

  async refreshQuota(force = false) {
    if (!force && this.quota && Date.now() - this.quotaAt < 60000) return;
    if (this.quotaPending) return this.quotaPending;
    const epoch = this.epoch;
    this.quotaPending = (async () => {
      const user = await this.client.call('GetUserStatus');
      if (epoch !== this.epoch) throw new Error('后台已重新连接，请等待刷新');
      const email = user.userStatus?.email;
      const identity = email ? createHash('sha256').update(email).digest('hex') : null;
      if (identity !== this.identity) { this.client.resetTrajectories?.(); this.quota = null; this.quotaAt = 0; this.sessions.clear(); this.summaries = []; this.summariesAt = 0; }
      this.identity = identity;
      const response = await this.client.call('RetrieveUserQuotaSummary');
      if (epoch !== this.epoch || identity !== this.identity) throw new Error('后台已重新连接，请等待刷新');
      this.quota = quotaMetrics(response);
      this.quotaAt = Date.now();
    })().finally(() => { this.quotaPending = null; });
    return this.quotaPending;
  }

  async listConversations(force = false) {
    if (!force && Date.now() - this.summariesAt < 5000) return this.summaries;
    const scope = this.identity, epoch = this.epoch;
    const response = await this.client.call('GetAllCascadeTrajectories');
    if (scope !== this.identity || epoch !== this.epoch) throw new Error('后台已重新连接，请等待刷新');
    this.summaries = Object.entries(response.trajectorySummaries || {}).map(([id, value]) => ({
      id, title: value.summary || '未命名会话', modifiedAt: value.lastModifiedTime, status: value.status,stepCount:value.stepCount,lastUserInputStepIndex:value.lastUserInputStepIndex,
    })).sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
    this.summariesAt = Date.now();
    return this.summaries;
  }

  async session(id, force = false, { preferCached = false, signal = null } = {}) {
    if (!GUID.test(id)) throw new Error('会话标识无效');
    if (signal?.aborted) { const err = new Error('请求已取消'); err.name = 'AbortError'; throw err; }
    const scope = this.identity, epoch = this.epoch;
    let entry = this.sessions.get(id);
    const cacheTtlMs = entry?.data?.liveTiming?.isRunning ? 450 : 1800;
    const ramFresh = Boolean(!force && entry?.data && Date.now() - entry.updatedAt < cacheTtlMs);
    if (ramFresh) return entry.data;
    const cachedSummary = this.client?.reader?.summaries?.[id] || null;
    if (preferCached && !force) {
      if (usableMetrics(entry?.data)) {
        const upToDate = Boolean(cachedSummary && isSavedFreshForSummary({ metrics: entry.data, savedAt: entry.savedAt || new Date(entry.updatedAt || 0).toISOString() }, cachedSummary));
        return { ...entry.data, conversationId: id, speedRefreshing: !upToDate };
      }
      if (scope) {
        const saved = await this.history.load(scope, id);
        if (scope !== this.identity || epoch !== this.epoch) throw new Error('后台已重新连接，请等待刷新');
        if (saved && usableMetrics(saved.metrics)) {
          entry ||= {};
          this.sessions.set(id, entry);
          if (!entry.data) { entry.data = { ...saved.metrics, conversationId: id }; entry.savedAt = saved.savedAt; }
          const upToDate = isSavedFreshForSummary(saved, cachedSummary);
          if (upToDate) entry.updatedAt = Date.now();
          return { ...entry.data, conversationId: id, restoredFromHistory: false, savedAt: entry.savedAt || saved.savedAt, speedRefreshing: !upToDate };
        }
      }
      return null;
    }
    if (entry?.pending) {
      if (!signal) return entry.pending;
      return new Promise((resolve, reject) => {
        const onAbort = () => { const err = new Error('请求已取消'); err.name = 'AbortError'; reject(err); };
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
        entry.pending.then(v => { signal.removeEventListener('abort', onAbort); resolve(v); }, e => { signal.removeEventListener('abort', onAbort); reject(e); });
      });
    }
    entry ||= {};
    this.sessions.set(id, entry);
    const current = () => scope === this.identity && epoch === this.epoch && this.sessions.get(id) === entry;
    entry.pending = (async () => {
      let loadedSaved = null;
      if (!entry.data && scope) {
        const saved = await this.history.load(scope,id);
        if (!current()) throw new Error('后台已重新连接，请等待刷新');
        if (saved) { loadedSaved = saved; entry.data = saved.metrics; entry.savedAt = saved.savedAt; }
      }
      const summaryNow = this.client?.reader?.summaries?.[id] || null;
      if (!force && summaryNow && isSavedFreshForSummary(loadedSaved || (entry.data ? { metrics: entry.data, savedAt: entry.savedAt } : null), summaryNow)) {
        entry.data = { ...entry.data, conversationId: id, contextRestored: false, restoredFromHistory: false };
        entry.updatedAt = Date.now();
        return entry.data;
      }
      const raw = await this.client.trajectory(id,{force,signal});
      if (!current()) throw new Error('后台已重新连接，请等待刷新');
      if(this.onTrajectory&&scope){try{await this.onTrajectory(scope,id,raw);if(current())this.usagePersistenceError=false;}catch{if(current())this.usagePersistenceError=true;}}
      if (!current()) throw new Error('后台已重新连接，请等待刷新');
      const fresh = trajectoryMetrics(raw);
      if (shouldKeepSaved(entry.data,fresh)) {
        entry.updatedAt = Date.now();
        entry.data = {...entry.data,context:fresh.context,contextRestored:false,restoredFromHistory:true,savedAt:entry.savedAt || null};
        if (fresh.context) {
          try { const saved=await this.history.save(scope,id,entry.data); if(saved)entry.savedAt=saved.savedAt; }
          catch { this.persistenceError='统计暂时无法保存到本地'; }
        }
        if (!current()) throw new Error('后台已重新连接，请等待刷新');
        return entry.data;
      }
      entry.data = {...fresh,conversationId:id,contextRestored:false,restoredFromHistory:false}; entry.updatedAt = Date.now();
      try { const saved = await this.history.save(scope,id,entry.data); if (saved) entry.savedAt = saved.savedAt; if (current()) this.persistenceError = null; }
      catch { this.persistenceError = '统计暂时无法保存到本地'; }
      if (!current()) throw new Error('后台已重新连接，请等待刷新');
      return entry.data;
    })().catch(error => {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      if (current() && usableMetrics(entry.data)) { entry.updatedAt = Date.now(); entry.data = {...entry.data,restoredFromHistory:true,savedAt:entry.savedAt || null}; return entry.data; }
      throw error;
    }).finally(() => { entry.pending = null; });
    return entry.pending;
  }

  async snapshot({ conversationId, force = false, preferCached = false, signal = null } = {}) {
    let connection = 'live', error = null, speed = null, sessionError = null;
    try {
      const server = await this.client.discover();
      if (server.pid !== this.serverPid) {
        this.epoch++; this.quota = null; this.quotaAt = 0; this.sessions.clear(); this.identity = null; this.summaries = []; this.summariesAt = 0; this.serverPid = server.pid;
      }
      try { await this.refreshQuota(force); }
      catch (e) { connection = this.quota ? 'stale' : 'offline'; error = e.message; }
      let summaries = this.summaries;
      // The inline composer already supplies its exact ID. Enumerating every
      // conversation first adds unrelated RPC latency to a route transition.
      if (!conversationId) {
        try { summaries = await this.listConversations(force); }
        catch (e) { connection = this.quota ? 'stale' : 'offline'; error ||= e.message; }
      }
      const selected = conversationId || summaries[0]?.id;
      if (selected) {
        try { speed = await this.session(selected, force, { preferCached, signal }); }
        catch (e) { if (e?.name === 'AbortError') throw e; sessionError = e.message; }
      }
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      connection = this.quota ? 'stale' : 'offline'; error = e.message;
      if (conversationId) speed = await this.cachedSession(conversationId);
    }
    return {
      connection, error, sessionError, serverTime: new Date().toISOString(),
      quotaUpdatedAt: this.quotaAt ? new Date(this.quotaAt).toISOString() : null,
      groups: this.quota || [], speed, conversations: this.summaries,
      persistenceError: this.persistenceError,
      source: 'Antigravity local API',
    };
  }
}
