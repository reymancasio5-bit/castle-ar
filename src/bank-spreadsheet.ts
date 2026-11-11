import type { ImportCell, ImportSheet } from './import.ts';
import type { BankDeposit } from './bank-statement.ts';
import { parseMoney } from './domain.ts';

const requiredHeaders = ['account number', 'transaction date', 'description 1', 'description 2', 'cad$'];
const text = (cell: ImportCell | undefined) => cell?.value == null ? '' : String(cell.value);
const header = (cell: ImportCell | undefined) => text(cell).trim().replace(/\s+/g, ' ').toLowerCase();
const blank = (row: ImportCell[]) => row.every(cell => !text(cell).trim() && !cell.formula && !cell.error);

function transactionDate(value: unknown): string {
 let date: string;
 if (value instanceof Date && Number.isFinite(value.getTime())) date = value.toISOString().slice(0, 10);
 else if (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value < 2958466 && Math.floor(value) !== 60) {
  // Excel's 1900 date system includes a fictitious February 29; reject that day.
  const epoch = Date.UTC(1899, 11, value < 60 ? 31 : 30);
  date = new Date(epoch + Math.floor(value) * 86400000).toISOString().slice(0, 10);
 } else if (typeof value === 'string') {
  const raw = value.trim(), us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  date = us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : raw;
 } else throw new Error('Missing or invalid transaction date.');
 if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1900-01-01' || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
  throw new Error('Use a valid transaction date (YYYY-MM-DD or MM/DD/YYYY).');
 }
 return date;
}

export function parseBankSpreadsheet(sheets: ImportSheet[], source: string): { deposits: BankDeposit[]; warnings: string[] } {
 const deposits: BankDeposit[] = [], warnings: string[] = [];
 let recognized = false;
 for (const sheet of sheets) {
  const location = `${source} / ${sheet.name}`;
  if (sheet.error) throw new Error(`${location}: ${sheet.error}`);
  if (sheet.rows.every(blank)) continue;
  const headerRow = sheet.rows.findIndex(row => requiredHeaders.every(name => row.some(cell => header(cell) === name)));
  if (headerRow < 0) throw new Error(`${location}: Unsupported bank spreadsheet. Use an RBC CAD transaction export with Account Number, Transaction Date, Description 1, Description 2, and CAD$ columns.`);
  const headings = sheet.rows[headerRow].map(header);
  const columns = requiredHeaders.map(name => headings.indexOf(name));
  if (requiredHeaders.some(name => headings.filter(h => h === name).length !== 1) || columns.some(c => sheet.rows[headerRow][c].formula || sheet.rows[headerRow][c].error)) {
   throw new Error(`${location}: Bank column headings must be unique plain values.`);
  }
  recognized = true;
  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
   const row = sheet.rows[r];
   if (blank(row)) continue;
   const [accountCell, dateCell, first, second, amountCell] = columns.map(c => row[c]);
   const description = [text(first), text(second)].filter(Boolean).join(' ').trim();
   const airbnb = /\bAIRBNB\s+PAYMENTS\b/i.test(description);
   const owner = description.match(/e-Transfer\s*[-–]\s*Autodeposit\b\s*(.*)$/i);
   if (!airbnb && !owner) continue;
   try {
    if (columns.some(c => row[c]?.formula || row[c]?.error)) throw new Error('Formula or error cells cannot be used as bank evidence. Export the original transaction values.');
    const amountCents = parseMoney(amountCell?.value);
    if (amountCents === null) throw new Error('Missing deposit amount.');
    if (amountCents <= 0) continue;
    const rawAccount = text(accountCell).trim();
    if (!/^\d[\d -]*$/.test(rawAccount) || rawAccount.replace(/\D/g, '').length < 4) throw new Error('Missing or invalid bank account number.');
    const account = rawAccount.replace(/\D/g, '').slice(-4);
    const date = transactionDate(dateCell?.value);
    if (owner) {
     const detail = owner[1].trim();
     const candidate = detail.match(/(?:^|\s)([A-Za-z0-9]{6,})$/);
     // Like PDF imports, require a digit so surnames cannot become fabricated references.
     const reference = candidate && /\d/.test(candidate[1]) ? candidate[1] : '';
     const ownerName = reference ? detail.slice(0, candidate!.index).trim() : detail;
     deposits.push({kind:'owner',ownerName,account,date,amountCents,reference,source});
    } else {
     const reference = description.match(/\bAIRBNB\s+PAYMENTS\s+(\d{10,})\b/i)?.[1] ?? '';
     deposits.push({account,date,amountCents,reference,source});
    }
   } catch (error) {
    warnings.push(`${location}, row ${r + 1}: ${error instanceof Error ? error.message : 'Unreadable bank transaction.'}`);
   }
  }
 }
 if (!recognized) throw new Error(`${source}: No bank transaction worksheet was found.`);
 return {deposits,warnings};
}
