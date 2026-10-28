import type { Payment, Property } from './types.ts';

export function parseMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Enter a valid amount.');
  let raw = String(value).trim();
  if (!raw) return null;
  if (raw.startsWith('(') && raw.endsWith(')')) raw = '-' + raw.slice(1, -1).trim();
  raw = raw.replace(/^(-?)\s*(?:CAD|USD|C\$|US\$|\$|€|£)\s*/i, '$1');
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) throw new Error('Use an amount like 1,234.56.');
  const number = Number(raw.replace(/,/g, ''));
  const cents = Math.sign(number) * Math.round((Math.abs(number) + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > 999999999999) throw new Error('Amount is too large.');
  return Object.is(cents, -0) ? 0 : cents;
}
export const money = (cents: number | null) => cents === null ? '—' : (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const collected = (property: Property) => property.payments.reduce((sum, payment) => sum + (payment.amountCents ?? 0), 0);
export const balance = (property: Property) => property.totalCents - collected(property);
export const systemStatus = (payment: Payment): 'Matched' | 'Mismatch' | 'Pending' => payment.bundleCents === null || payment.bankCents === null ? 'Pending' : payment.bundleCents === payment.bankCents ? 'Matched' : 'Mismatch';
