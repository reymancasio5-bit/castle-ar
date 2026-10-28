import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentDraftToFields, type PaymentDraft } from '../src/editor.ts';
import type { Payment } from '../src/types.ts';

const refund: Payment = {
  id: 'refund', type: 'Airbnb', amountCents: -12345, payoutDate: '2026-11-02',
  bundleCents: -12345, bankDate: '2026-11-03', bankCents: -12345, verifiedByDaisy: false,
};
const refundDraft: PaymentDraft = {
  amount: '-123.45', payoutDate: '2026-11-02', bundle: '-123.45',
  bankDate: '2026-11-03', bank: '-123.45', verifiedByDaisy: false,
};

test('an existing refund permits verification and date edits without rewriting its amounts', () => {
  assert.deepEqual(paymentDraftToFields(refund, { ...refundDraft, bankDate: '2026-11-04', verifiedByDaisy: true }), {
    bankDate: '2026-11-04', verifiedByDaisy: true,
  });
});

test('the editor accepts newly entered negative payment, bundle, and bank amounts', () => {
  const original = { ...refund, amountCents: 0, bundleCents: null, bankCents: null };
  assert.deepEqual(paymentDraftToFields(original, refundDraft), {
    amountCents: -12345, bundleCents: -12345, bankCents: -12345,
  });
});

test('blank clears an existing amount while zero remains an explicit amount', () => {
  const original = { ...refund, amountCents: 500, bundleCents: null, bankCents: 500 };
  assert.deepEqual(paymentDraftToFields(original, { ...refundDraft, amount: '', bundle: '0', bank: '0.00' }), {
    amountCents: null, bundleCents: 0, bankCents: 0,
  });
});

test('unchanged values, including refunds and explicit zero, produce no payment mutation', () => {
  assert.deepEqual(paymentDraftToFields(refund, refundDraft), {});
  assert.deepEqual(paymentDraftToFields({ ...refund, amountCents: 0 }, { ...refundDraft, amount: '0.00' }), {});
});

test('malformed draft amounts are rejected before preparing a mutation', () => {
  assert.throws(() => paymentDraftToFields(refund, { ...refundDraft, amount: '12oops' }), /amount/i);
});
