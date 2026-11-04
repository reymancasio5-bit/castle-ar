import { parseMoney } from './domain.ts';
import type { Payment } from './types.ts';

export interface PaymentDraft {
  bankDetails?: string;
  type?: Payment['type'];
  amount: string;
  payoutDate: string;
  bundle: string;
  bankDate: string;
  bank: string;
  verifiedByDaisy: boolean;
}

export function paymentDraftToFields(payment: Payment, draft: PaymentDraft): Partial<Omit<Payment, 'id'>> {
  const next: Omit<Payment, 'id' | 'type'> = {
    amountCents: parseMoney(draft.amount), payoutDate: draft.payoutDate,
    bundleCents: parseMoney(draft.bundle), bankDate: draft.bankDate,
    bankCents: parseMoney(draft.bank), verifiedByDaisy: draft.verifiedByDaisy,
  };
  const fields: Partial<Omit<Payment, 'id'>> = {};
  if (next.amountCents !== payment.amountCents) fields.amountCents = next.amountCents;
  if (next.payoutDate !== payment.payoutDate) fields.payoutDate = next.payoutDate;
  if (next.bundleCents !== payment.bundleCents) fields.bundleCents = next.bundleCents;
  if (next.bankDate !== payment.bankDate) fields.bankDate = next.bankDate;
  if (next.bankCents !== payment.bankCents) fields.bankCents = next.bankCents;
  if (next.verifiedByDaisy !== payment.verifiedByDaisy) fields.verifiedByDaisy = next.verifiedByDaisy;
  if (draft.bankDetails !== undefined && draft.bankDetails.trim() !== (payment.bankDetails ?? '')) fields.bankDetails = draft.bankDetails.trim();
  if (draft.type !== undefined && draft.type !== payment.type) fields.type = draft.type;
  return fields;
}
