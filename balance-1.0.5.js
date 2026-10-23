// Sum decimal strings exactly, without binary floating-point rounding.
export function sumWallets(wallets) {
  const totals = new Map();
  for (const {currency, balance} of wallets) {
    const [mantissa, exponent = '0'] = balance.toLowerCase().split('e');
    const scale = (mantissa.split('.')[1]?.length || 0) - Number(exponent);
    if (!Number.isSafeInteger(scale) || Math.abs(scale) > 400) throw new Error('Invalid scale');
    const digits = BigInt(mantissa.replace('.', ''));
    const previous = totals.get(currency) || {digits:0n, scale:0};
    const target = Math.max(previous.scale, scale, 0);
    totals.set(currency, {digits: previous.digits * 10n ** BigInt(target - previous.scale) + digits * 10n ** BigInt(target - scale), scale:target});
  }
  return [...totals].map(([currency, {digits, scale}]) => {
    const sign = digits < 0n ? '-' : '';
    const raw = (digits < 0n ? -digits : digits).toString().padStart(scale + 1, '0');
    const balance = scale ? `${raw.slice(0, -scale)}.${raw.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '') : raw;
    return {currency, balance: sign + balance};
  });
}
// Only allowlisted, non-credential account detail fields cross the wire.
export function normalizeBalance(value, checkedAt = Date.now()) {
  if (value == null) return { status: 'signed-out', checkedAt };
  if (value.status !== 'ready') return { status: 'failed', checkedAt };
  const wallets = (rows) => {
    if (!Array.isArray(rows)) throw new Error('Invalid wallets');
    return rows.map(row => {
      if (!['USD', 'CNY'].includes(row?.currency) || typeof row.balance !== 'string' || !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(row.balance) || !Number.isFinite(Number(row.balance))) throw new Error('Invalid wallet');
      return { currency: row.currency, balance: row.balance };
    });
  };
  try {
    const normal = wallets(value.value), bonus = wallets(value.bonusWallets);
    return { status: 'ready', normal, bonus, total: sumWallets([...normal, ...bonus]), checkedAt };
  }
  catch { return { status: 'failed', checkedAt }; }
}
