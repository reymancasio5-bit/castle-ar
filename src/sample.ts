import type { Payment, Snapshot } from './types.ts';
function payments(row: number, amounts: (number | null)[]): Payment[] {
  return amounts.map((amountCents, index) => ({ id: `0:${row+index}`, type: index < 3 ? 'Airbnb' : index === 3 ? 'Vrbo' : 'Owner', amountCents, payoutDate: '', bundleCents: null, bankDate: '', bankCents: null, verifiedByDaisy: false }));
}
export const sampleSnapshot: Snapshot = {
 revision: 'preview-1', updatedAt: '2026-10-28T16:00:00Z',
 spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1EGS6cj8WKfUlH8ayk5cXaB9KW53xu7vEbl4oboAJxPY/edit',
 months: [{ id: '0', label: 'Nov, 2026', month: '2026-11', properties: [
  { id: '0:4', name: 'Mtl 404 Le Bijou', manager: 'Team B', totalCents: 44204, sourceArCents: 44204, payments: payments(5, [null,null,null,null,0]) },
  { id: '0:12', name: 'Mtl 2429 Rue Allard Unit 1', manager: 'Team A', totalCents: 24338, sourceArCents: 24338, payments: payments(13, [null,null,null,null,0]) },
  { id: '0:20', name: 'Tor Unit 918-251 Jarvis St', manager: 'Team B', totalCents: 37048, sourceArCents: 4562, payments: payments(21, [11686,13081,7719,null,0]) }
 ]}]
};
