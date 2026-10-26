window.__ModuleLoader__.load({
  id: '@local/dsh-sidebar-account-meter',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
// Uses only the installed plugin's public same-origin settings-card API.
// Control key stays in this request closure; never publish/log it or raw errors.
async function readWorkBuddy(signal, request = fetch) {
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

    return {
      inject: ['slots', 'connection', 'locale'],
      apply(ctx) {
        function Meter({ wide }) {
          const locale = React.useSyncExternalStore(fn => ctx.locale.subscribe(fn), () => ctx.locale.getSnapshot()).active;
          const zh = locale.toLowerCase().startsWith('zh');
          const t = (cn, en) => zh ? cn : en;
          const [data, setData] = React.useState(null);
          const [wb, setWb] = React.useState(null);
          const [wbBusy, setWbBusy] = React.useState(false);
          const [busy, setBusy] = React.useState(false);
          const [error, setError] = React.useState(false);
          const [tick, setTick] = React.useState(0);
          const detail = React.useRef(null);
          React.useEffect(() => {
            let alive = true, running = false;
            const controller = new AbortController();
            async function update() {
              if (running) return;
              running = true;
              setBusy(true);
              try {
                const result = await ctx.connection.rpc.call('/local-account-meter', 'status', {locale, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60}, AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]));
                if (!result.ok) throw new Error('request failed');
                if (alive) { setData(result.value); setError(false); }
              } catch (err) { if (alive) { setData(null); setError(String(err?.message || 'Connection failed').slice(0, 160)); } }
              finally { running = false; if (alive) setBusy(false); }
            }
            update();
            const timer = setInterval(update, 120000);
            return () => { alive = false; controller.abort(); clearInterval(timer); };
          }, [locale, tick]);
          React.useEffect(() => {
            let alive = true, running = false;
            const controller = new AbortController();
            async function update() {
              if (running) return;
              running = true; setWbBusy(true);
              const value = await readWorkBuddy(AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]));
              if (alive) { setWb(value); setWbBusy(false); }
              running = false;
            }
            update();
            const timer = setInterval(update, 120000);
            return () => { alive = false; controller.abort(); clearInterval(timer); };
          }, [tick]);
          // Host `reason` codes are diagnostics: show them only in the tooltip,
          // never as the primary label, so a dependency fault is distinguishable
          // from an expired token or an upstream failure.
          const REASONS = {
            'pi-ai dependency unavailable': ['依赖缺失 (pi-ai)', 'Missing dependency (pi-ai)'],
            'credentials dependency unavailable': ['依赖缺失 (credentials)', 'Missing dependency (credentials)'],
            'integration unavailable': ['插件加载失败', 'Plugin load failed'],
            'authentication failed': ['鉴权失败', 'Authentication failed'],
            'usage request failed': ['接口请求失败', 'Usage request failed'],
            'timeout': ['请求超时', 'Timed out'],
          };
          const reason = row => {
            const hit = REASONS[row?.reason];
            return hit ? t(hit[0], hit[1]) : null;
          };
          const status = row => {
            if (!row) return error ? t('连接失败', 'Offline') : t('查询中…', 'Loading…');
            if (row.status === 'signed-out') return t('未登录', 'Signed out');
            if (row.status === 'auth-required') return t('请重新登录', 'Sign in again');
            if (row.status === 'unavailable') return t('暂无额度数据', 'Unavailable');
            return t('查询失败', 'Query failed');
          };
          const duration = seconds => !seconds ? t('额度', 'Window') : seconds >= 86400 ? `${+(seconds / 86400).toFixed(1)}${t('天', 'd')}` : `${+(seconds / 3600).toFixed(1)}h`;
          const money = rows => rows?.length ? rows.map(w => `${w.currency === 'CNY' ? '¥' : '$'}${Number(w.balance).toLocaleString(locale, {maximumFractionDigits: 4})}`).join(' / ') : '—';
          const c = data?.codex, d = data?.deepseek;
          const codex = c?.status === 'ready' ? c.windows.map(w => `${Math.round(w.remaining)}%`).join(' / ') || t('暂无额度数据', 'Unavailable') : status(c);
          const plan = c?.planLabel || t('档位未知', 'Unknown plan');
          const codexReason = c?.status === 'ready' ? null : reason(c);
          const codexTitle = c ? `Codex ${plan}${codexReason ? ` (${codexReason})` : ''}` : 'Codex';
          const ds = d?.status === 'ready' ? money(d.total) : status(d);
          const credits = row => row.status === 'ready' ? (row.unlimited ? t('无限额', 'Unlimited') : `${row.total.toLocaleString(locale, {maximumFractionDigits:2})} ${t('积分', 'credits')}`) : status(row);
          const wbSummary = !wb ? t('查询中…', 'Loading…') : wb.accounts.length === 1 ? credits(wb.accounts[0]) : wb.accounts.length > 1 ? `${wb.accounts.filter(a => a.status === 'ready').length}/${wb.accounts.length} ${t('账户可用', 'accounts ready')}` : status(wb);
          const label = t('用量与余额', 'Usage & balance');
          const base = {font: 'inherit', color: 'var(--dsw-alias-label-primary)'};
          const secondary = {color: 'var(--dsw-alias-label-secondary)', fontSize: 11};
          const section = {marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l1)'};
          return h('details', {ref: detail, style: {position: 'relative', minWidth: 0, width: wide ? '100%' : undefined, alignSelf: 'stretch'}, onKeyDown: e => { if (e.key === 'Escape') { detail.current.open = false; detail.current.querySelector('summary')?.focus(); } }},
            h('summary', {title: label, 'aria-label': `${label}: ${codexTitle} ${codex}; DeepSeek ${ds}; WorkBuddy ${wbSummary}`, style: {...base, cursor: 'pointer', listStyle: 'none', borderRadius: 7, padding: wide ? '8px 0' : 6, fontSize: 13, lineHeight: '20px', zoom: wide ? 0.8 : 1, width: wide ? '100%' : 28, boxSizing: 'border-box'}},
              wide ? h(React.Fragment, null,
                h('div', {style:{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginBottom:5}},
                  h('strong', {style:{fontSize:14}}, 'Codex'), h('span', {style:{...secondary,fontSize:12}}, c ? plan : '')),
                c?.status === 'ready' ? c.windows.map((w,i) => h('div', {key:i,style:{display:'flex',alignItems:'center',gap:8,marginTop:4}},
                  c.windows.length > 1 ? h('span', {style:{...secondary,minWidth:24}}, duration(w.durationSeconds)) : null,
                  h('div', {role:'progressbar','aria-label':`${duration(w.durationSeconds)} ${t('剩余','remaining')}`,'aria-valuenow':w.remaining,'aria-valuemin':0,'aria-valuemax':100,style:{flex:1,height:8,borderRadius:4,overflow:'hidden',background:'var(--dsw-alias-border-l1)'}},
                    h('div', {style:{width:`${w.remaining}%`,height:'100%',borderRadius:4,background:'var(--dsw-alias-brand-primary)'}})),
                  h('strong', {style:{fontSize:15,minWidth:38,textAlign:'right',fontVariantNumeric:'tabular-nums'}}, `${Math.round(w.remaining)}%`)))
                  : h('div', {style:secondary}, status(c)),
                h('div', {style:{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginTop:12,paddingTop:10,borderTop:'1px solid var(--dsw-alias-border-l1)'}},
                  h('span', {style:{fontSize:13}}, 'DeepSeek'),
                  h('strong', {style:{fontSize:d?.status === 'ready' ? 20 : 12,lineHeight:'26px',fontWeight:650,textAlign:'right',fontVariantNumeric:'tabular-nums',overflowWrap:'anywhere'}}, ds)),
                h('div', {style:{display:'flex',justifyContent:'space-between',gap:8,marginTop:8}}, h('span', null, 'WorkBuddy'), h('strong', {style:{fontSize:12,textAlign:'right',overflowWrap:'anywhere'}}, wbSummary)))
                : h('span', {'aria-hidden':true, style:{fontSize:18}}, '◴')),
            h('div', {style: {...base, position:'absolute', bottom:'calc(100% + 10px)', left:0, width:260, maxWidth:'calc(100vw - 24px)', maxHeight:'min(560px, 70vh)', overflowY:'auto', boxSizing:'border-box', padding:14, borderRadius:12, background:'var(--dsw-alias-bg-layer-1)', border:'1px solid var(--dsw-alias-border-l1)', zIndex:50, fontSize:12, lineHeight:1.6}},
              h('strong', null, label), error ? h('div', {style:secondary}, error) : null,
              h('div', {style: section}, h('strong', null, 'Codex'), h('div', {style:secondary}, `${t('订阅档位', 'Subscription')}: ${plan}`),
                c?.status === 'ready' ? c.windows.map((w,i) => h('div', {key:i}, h('div', null, `${duration(w.durationSeconds)} · ${t('剩余', 'remaining')} ${Math.round(w.remaining)}%`), h('progress', {value:w.remaining,max:100,style:{width:'100%',height:5,accentColor:'var(--dsw-alias-brand-primary)'}}), w.resetAt ? h('div', {style:secondary}, `${t('重置', 'Resets')}: ${new Date(w.resetAt).toLocaleString(locale)}`) : null)) : h('div', {style:secondary}, status(c), c?.reason ? ` (${c.reason})` : '')),
              h('div', {style:section}, h('strong', null, 'DeepSeek Account'), d?.status === 'ready' ? h('div', null, `${t('总余额', 'Total balance')}: ${money(d.total)}`) : h('div', {style:secondary}, status(d))),
              h('div', {style:section}, h('strong', null, 'WorkBuddy'),
                wb?.accounts.length ? wb.accounts.map((a,i) => h('div', {key:i,style:{marginTop:8,overflowWrap:'anywhere'}},
                  h('div', {style:secondary}, `${a.label} · ${a.region === 'cn' ? t('国内版','CN') : t('国际版','Global')}${a.enabled ? '' : t(' · 已停用',' · Disabled')}`),
                  h('div', null, credits(a)))) : h('div', {style:secondary}, wbSummary),
                wb?.checkedAt ? h('div', {style:secondary}, `${t('更新于','Updated')} ${new Date(wb.checkedAt).toLocaleTimeString(locale)}`) : null),
              h('div', {style:{...secondary,marginTop:12}}, data ? `${t('更新于', 'Updated')} ${new Date(Math.max(c?.checkedAt || 0,d?.checkedAt || 0)).toLocaleTimeString(locale)}` : '', h('div', null,t('每 2 分钟自动刷新', 'Refreshes every 2 minutes'))),
              h('button', {type:'button', disabled:busy || wbBusy, onClick:()=>setTick(v=>v+1), style:{...base,marginTop:8,padding:'4px 10px',border:'1px solid var(--dsw-alias-border-l1)',borderRadius:6,background:'var(--dsw-alias-bg-layer-2)',cursor:'pointer'}},busy || wbBusy ? t('刷新中…','Refreshing…') : t('刷新','Refresh'))));
        }
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({name:'sidebar.footer.action',id:'local-account-meter',order:-10,label:'Usage & balance'}, Meter));
      },
    };
  },
});
