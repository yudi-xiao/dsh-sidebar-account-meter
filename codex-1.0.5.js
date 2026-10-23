// Host only. Peer packages: @earendil-works/pi-ai 1.1.0 and
// @deepseek-ai/dsh-credentials 0.2.1-rc.2. Imports stay lazy for pure tests.
const PROVIDER = 'openai-codex';
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const MAX_BYTES = 256 * 1024;
const MAX_DATE = 8.64e15;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const timestamp = value => finite(value) && value >= 0 && value <= MAX_DATE ? value : null;
const result = (status, checkedAt) => ({ status, windows: [], checkedAt });
// Never copy arbitrary response text (including an unexpected token) into the UI.
// Official labels: https://github.com/openai/codex/blob/main/codex-rs/tui/src/subscription.rs
const PLAN_LABELS = new Map(Object.entries({
  free: 'Free', go: 'Go', plus: 'Plus', prolite: 'Pro 100', pro: 'Pro 200', promax: 'Pro 500',
  team: 'Business', self_serve_business_usage_based: 'Business',
  self_serve_business_prolite: 'Business Premium', business: 'Enterprise',
  enterprise: 'Enterprise', ent26: 'Enterprise', enterprise_cbp_usage_based: 'Enterprise',
  enterprise_cbp_automation: 'Enterprise (Automation)', edu: 'Edu', edu_plus: 'Edu Plus', edu_pro: 'Edu Pro',
}));

/** Pure projection. remaining is percent; resetAt/checkedAt are epoch milliseconds. */
export function normalizeCodexUsage(payload, checkedAt) {
  if (timestamp(checkedAt) === null) throw new TypeError('Invalid checkedAt');
  const windows = [];
  const limit = object(payload) && object(payload.rate_limit) ? payload.rate_limit : {};
  for (const window of [limit.primary_window, limit.secondary_window]) {
    if (!object(window) || !finite(window.used_percent)) continue;
    const durationSeconds = finite(window.limit_window_seconds) && window.limit_window_seconds > 0
      && window.limit_window_seconds <= Number.MAX_SAFE_INTEGER ? window.limit_window_seconds : null;
    const absolute = finite(window.reset_at) ? timestamp(window.reset_at * 1000) : null;
    const relative = finite(window.reset_after_seconds) && window.reset_after_seconds >= 0
      ? timestamp(checkedAt + window.reset_after_seconds * 1000) : null;
    windows.push({
      remaining: Math.max(0, Math.min(100, 100 - window.used_percent)),
      durationSeconds,
      resetAt: absolute ?? relative,
    });
  }
  const plan = object(payload) && typeof payload.plan_type === 'string' && PLAN_LABELS.has(payload.plan_type)
    ? payload.plan_type : undefined;
  return { status: windows.length ? 'ready' : 'unavailable', windows,
    ...(plan === undefined ? {} : { plan, planLabel: PLAN_LABELS.get(plan) }), checkedAt };
}

// Race non-cancellable imports/store reads without leaking the signal's reason.
function wait(promise, signal) {
  if (signal.aborted) {
    void Promise.resolve(promise).catch(() => {});
    return Promise.reject(new Error('Cancelled'));
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function oauth(record) {
  return record?.kind === 'grant' && object(record.payload) && record.payload.type === 'oauth'
    ? record.payload : undefined;
}
function validGrant(value) {
  return value && typeof value.access === 'string' && value.access.length > 0
    && finite(value.expires) && typeof value.refresh === 'string' && value.refresh.length > 0;
}
async function boundedJSON(response, signal) {
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  if (!response.body) throw new Error('Missing response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await wait(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Response too large');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    // Cancellation is best effort and must not keep a cancelled caller waiting.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Read only this provider's grant. Never return/log credentials, account ids, or raw errors. */
export async function readCodex(credentials, signal) {
  const checkedAt = Date.now();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timer = setTimeout(cancel, 25_000);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const operation = controller.signal;
  let phase = 'setup';
  try {
    operation.throwIfAborted();
    if (!credentials?.readRecord || !credentials?.modifyRecord) return result('unavailable', checkedAt);
    const [{ credentialKey }, { createModels }, { openaiCodexProvider }] = await wait(Promise.all([
      import('@deepseek-ai/dsh-credentials'),
      import('@earendil-works/pi-ai/models'),
      import('@earendil-works/pi-ai/providers/openai-codex'),
    ]), operation);
    const key = credentialKey('llm-pi-ai', PROVIDER);
    const stored = await wait(credentials.readRecord(key), operation);
    if (!stored) return result('signed-out', checkedAt);
    if (!validGrant(oauth(stored))) return result('auth-required', checkedAt);
    let resolvedGrant;
    const store = {
      async read(id, options) {
        if (id !== PROVIDER) return undefined;
        options?.signal?.throwIfAborted();
        resolvedGrant = oauth(await credentials.readRecord(key));
        return resolvedGrant;
      },
      async modify(id, mutate, options) {
        if (id !== PROVIDER) throw new Error('Unexpected provider');
        options?.signal?.throwIfAborted();
        const post = await credentials.modifyRecord(key, async current => {
          // Cancellation before obtaining the lock prevents a new refresh. Once
          // refresh begins, pi-ai intentionally persists rotation despite abort.
          options?.signal?.throwIfAborted();
          const next = await mutate(oauth(current));
          return next === undefined ? undefined : { kind: 'grant', payload: next };
        });
        resolvedGrant = oauth(post);
        return resolvedGrant;
      },
    };
    const models = createModels({ credentials: store });
    models.setProvider(openaiCodexProvider());
    phase = 'auth';
    // Public bridge: five-minute validity check, double-checked lock and a
    // separately bounded (15s) refresh. Upstream refresh owns its HTTP policy;
    // redirect:error and the byte limit below apply to our usage GET only.
    const auth = await wait(models.getAuth(PROVIDER, { signal: operation }), operation);
    operation.throwIfAborted();
    if (!auth) return result('signed-out', checkedAt);
    const token = auth.auth?.apiKey;
    const account = resolvedGrant?.accountId;
    if (typeof token !== 'string' || !token || typeof account !== 'string' || !account
      || /[\r\n]/.test(token + account)) return result('auth-required', checkedAt);
    phase = 'usage';
    const response = await fetch(USAGE_URL, {
      method: 'GET', redirect: 'error', signal: operation,
      headers: { Authorization: `Bearer ${token}`, 'ChatGPT-Account-Id': account, Accept: 'application/json' },
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return { ...result(response.status === 401 || response.status === 403 ? 'auth-required'
        : [404, 429, 501, 503].includes(response.status) ? 'unavailable' : 'failed', checkedAt), reason: `HTTP ${response.status}` };
    }
    return normalizeCodexUsage(await boundedJSON(response, operation), checkedAt);
  } catch (error) {
    const reason = operation.aborted ? 'timeout' : phase === 'setup' ? (String(error?.message).includes('@earendil-works/pi-ai') ? 'pi-ai dependency unavailable' : String(error?.message).includes('@deepseek-ai/dsh-credentials') ? 'credentials dependency unavailable' : 'integration unavailable') : phase === 'auth' ? 'authentication failed' : 'usage request failed';
    return { ...result(operation.aborted || phase === 'setup' ? 'unavailable'
      : phase === 'auth' ? 'auth-required' : 'failed', checkedAt), reason };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
