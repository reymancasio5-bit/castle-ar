export type PaymentType = 'Airbnb' | 'Vrbo' | 'Owner';
export interface Payment { id: string; type: PaymentType; amountCents: number | null; payoutDate: string; bundleCents: number | null; bankDate: string; bankCents: number | null; verifiedByDaisy: boolean; }
export interface Property { id: string; name: string; manager: string; totalCents: number; payments: Payment[]; sourceArCents?: number; }
export interface Month { id: string; label: string; month: string; properties: Property[]; }
export interface Snapshot { revision: string; months: Month[]; updatedAt: string; spreadsheetUrl: string; }
export type Change = { kind: 'setTotal'; propertyId: string; amountCents: number } | { kind: 'updatePayment'; paymentId: string; fields: Partial<Omit<Payment, 'id' | 'type'>> } | { kind: 'addProperty'; monthId: string; name: string; manager: string; totalCents: number };
export interface ImportProps { month: Month; onClose: () => void; onApply: (changes: Change[]) => Promise<void>; }
