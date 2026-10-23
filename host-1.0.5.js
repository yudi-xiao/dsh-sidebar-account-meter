import { readCodex } from './codex-1.0.5.js';
import { normalizeBalance } from './balance-1.0.5.js';

export const inject = ['connection', 'webServer', 'credentials', 'deepseekAccount'];
export function apply(ctx) {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort());
  let pending;
  const status = async (method, args, signal, peer) => {
    const fail = (code) => ({ ok: false, error: { code, message: code, details: {} } });
    if (peer.principal.kind !== 'owner') return fail('forbidden');
    if (method !== 'status') return fail('not-found');
    if (!args || typeof args.locale !== 'string' || args.locale.length > 40 || !Number.isInteger(args.timezoneOffsetSeconds) || Math.abs(args.timezoneOffsetSeconds) > 86400) return fail('invalid-input');
    signal.throwIfAborted();
    if (!pending) {
      const client = { version: '0.2.1-rc.2', locale: args.locale, timezoneOffsetSeconds: args.timezoneOffsetSeconds };
      const requestSignal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(25000)]);
      pending = Promise.all([
        readCodex(ctx.credentials, requestSignal).catch(() => ({status: 'failed', checkedAt: Date.now()})),
        ctx.deepseekAccount.getBalance(client).then(value => normalizeBalance(value)).catch(() => ({status: 'failed', checkedAt: Date.now()})),
      ]).then(([codex, deepseek]) => ({ codex, deepseek })).finally(() => { pending = undefined; });
    }
    const value = await pending;
    signal.throwIfAborted();
    return { ok: true, value };
  };
  // Explicit supported HTTP route: this release's generic rpc.handle loses
  // the caller's webServer injection context inside its registration effect.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/local-account-meter/status',
    async handler(req, res) {
      const admission = ctx.connection.admit(req);
      if ('rejection' in admission) { res.writeHead(admission.rejection); res.end(); return; }
      if (admission.peer.principal.kind !== 'owner') { res.writeHead(403); res.end(); return; }
      if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json') { res.writeHead(400); res.end(); return; }
      const deadline = AbortSignal.timeout(30000);
      const terminate = () => { if (!res.writableEnded) { res.writeHead(408); res.end(); } };
      deadline.addEventListener('abort', terminate, {once:true});
      try {
        let body = '', bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 4096) { res.writeHead(413); res.end(); return; }
          body += chunk.toString('utf8');
        }
        const envelope = JSON.parse(body);
        if (envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string' || envelope.rpcId.length > 100 || envelope.method !== 'status') throw new Error('Invalid request');
        const result = await status(envelope.method, envelope.payload, deadline, admission.peer);
        if (!res.writableEnded) {
          res.writeHead(200, {'content-type':'application/json', 'cache-control':'no-store'});
          res.end(JSON.stringify({type:'server-response', rpcId:envelope.rpcId, result}));
        }
      } catch { if (!res.writableEnded) { res.writeHead(400); res.end(); } }
      finally { deadline.removeEventListener('abort', terminate); }
    },
  }));
}
