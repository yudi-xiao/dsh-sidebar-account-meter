// Uses only the installed plugin's public same-origin settings-card API.
// Control key stays in this request closure; never publish/log it or raw errors.
export async function readWorkBuddy(signal, request = fetch) {
  const checkedAt = Date.now();
  const unavailable = {status:'unavailable', checkedAt, accounts:[]};
  try {
    const response = await request('/plugins/dsh-workbuddy-oauth/status', {credentials:'same-origin', cache:'no-store', headers:{accept:'application/json'}, signal});
    if (!response.ok) return unavailable;
    const doc = await response.json();
    if (doc?.status !== 'ok' || typeof doc.controlKey !== 'string' || !Array.isArray(doc.accounts) || !Array.isArray(doc.regions)) return unavailable;
    if (!doc.accounts.length) return {status:'signed-out', checkedAt, accounts:[]};
    const accounts = [];
    // Serial queries avoid hammering upstream and share one bounded refresh deadline.
    for (const account of doc.accounts) {
      signal.throwIfAborted();
      if (typeof account?.uid !== 'string' || !['cn','global'].includes(account.region)) throw new Error('Invalid account');
      const row = {label:typeof account.label === 'string' ? account.label.slice(0,100) : 'WorkBuddy', region:account.region, enabled:account.enabled !== false, status:'failed'};
      try {
        const path = doc.regions.find(region => region.region === account.region)?.controlPath;
        // Never send the control key to a document-supplied arbitrary destination.
        if (!['/plugins/dsh-workbuddy-oauth/control','/plugins/dsh-workbuddy-oauth/ai/control'].includes(path)) throw new Error('Invalid route');
        const result = await request(path, {method:'POST', credentials:'same-origin', cache:'no-store', redirect:'error', headers:{'Content-Type':'application/json','x-workbuddy-oauth-key':doc.controlKey}, body:JSON.stringify({action:'refresh-credits',uid:account.uid}), signal});
        if (!result.ok) throw new Error('Request failed');
        const value = await result.json();
        if (value?.state !== 'ok' || !Number.isFinite(value.credits?.total) || !Array.isArray(value.credits.accounts)) throw new Error('Invalid credits');
        row.status = 'ready';
        row.total = value.credits.total;
        row.unlimited = value.credits.unlimited === true;
      } catch { /* Explicit failure, never retain an old balance. */ }
      accounts.push(row);
    }
    return {status:accounts.every(row => row.status === 'ready') ? 'ready' : 'partial', checkedAt, accounts};
  } catch { return unavailable; }
}
