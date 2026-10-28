import { parseMoney } from './domain.ts';
import type { Payment } from './types.ts';

export interface PaymentDraft {
  amount: string;
  payoutDate: string;
  bundle: string;
  bankDate: string;
  bank: string;
  verifiedByDaisy: boolean;
}

export function paymentDraftToFields(payment: Payment, draft: PaymentDraft): Partial<Omit<Payment, 'id' | 'type'>> {
  const next: Omit<Payment, 'id' | 'type'> = {
    amountCents: parseMoney(draft.amount), payoutDate: draft.payoutDate,
    bundleCents: parseMoney(draft.bundle), bankDate: draft.bankDate,
    bankCents: parseMoney(draft.bank), verifiedByDaisy: draft.verifiedByDaisy,
  };
  const fields: Partial<Omit<Payment, 'id' | 'type'>> = {};
  if (next.amountCents !== payment.amountCents) fields.amountCents = next.amountCents;
  if (next.payoutDate !== payment.payoutDate) fields.payoutDate = next.payoutDate;
  if (next.bundleCents !== payment.bundleCents) fields.bundleCents = next.bundleCents;
  if (next.bankDate !== payment.bankDate) fields.bankDate = next.bankDate;
  if (next.bankCents !== payment.bankCents) fields.bankCents = next.bankCents;
  if (next.verifiedByDaisy !== payment.verifiedByDaisy) fields.verifiedByDaisy = next.verifiedByDaisy;
  return fields;
}
