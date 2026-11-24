import type { ImportCell, ImportSheet } from './import.ts';
import type { BankDeposit } from './bank-statement.ts';
import {zelleMemo} from './wells-fargo.ts';
import { parseMoney } from './domain.ts';

export interface BankColumnMapping { headerRow: number; date: number; description: number; amount: number; account?: number; description2?: number; debit?: number; reference?: number; status?: number }
export interface BankSpreadsheetOptions { account?: string; mapping?: BankColumnMapping }
const aliases = {
 account: ['account number','account','account no','account #'],
 date: ['transaction date','date','posted date','posting date'],
 description: ['description 1','description','transaction description','memo','details'],
 description2: ['description 2'],
 amount: ['cad$','usd$','amount','transaction amount','credit','credits','deposit','deposits','credit amount'],
 debit: ['debit','debits','withdrawal','withdrawals','debit amount'],
 reference: ['reference','reference number','transaction id','reference #'],
 status: ['status','transaction status'],
};
export function detectBankColumns(sheet: ImportSheet, selectedRow?: number): BankColumnMapping {
 const headerRow = selectedRow ?? sheet.rows.findIndex(row => (['date','description','amount'] as const).every(key => row.some(cell => aliases[key].includes(header(cell)))));
 const headings = sheet.rows[Math.max(0,headerRow)]?.map(header) ?? [];
 const mapping: BankColumnMapping = {headerRow:Math.max(0,headerRow),date:-1,description:-1,amount:-1};
 for (const [key,names] of Object.entries(aliases)) {
  const matches=headings.flatMap((h,i)=>names.includes(h)?[i]:[]);
  if(matches.length===1) Object.assign(mapping,{[key]:matches[0]});
 }
 return mapping;
}
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

export function parseBankSpreadsheet(sheets: ImportSheet[], source: string, options: BankSpreadsheetOptions = {}): { deposits: BankDeposit[]; warnings: string[] } {
 const deposits: BankDeposit[] = [], warnings: string[] = [];
 let recognized = false;
 for (const sheet of sheets) {
  const location = `${source} / ${sheet.name}`;
  if (sheet.error) throw new Error(`${location}: ${sheet.error}`);
  if (sheet.rows.every(blank)) continue;
  const mapping = options.mapping ?? detectBankColumns(sheet);
  const {headerRow} = mapping;
  const columns = Object.entries(mapping).filter(([key,value])=>key!=='headerRow' && value!==undefined).map(([,value])=>value as number);
  if (![mapping.date,mapping.description,mapping.amount].every(c=>Number.isInteger(c)&&c>=0) || !Number.isInteger(headerRow) || !sheet.rows[headerRow]) {
   throw new Error(`${location}: Map the transaction date, description, and amount columns before importing.`);
  }
  if (new Set(columns).size!==columns.length || columns.some(c=>!Number.isInteger(c)||c<0||!sheet.rows[headerRow][c]||sheet.rows[headerRow][c].formula||sheet.rows[headerRow][c].error)) {
   throw new Error(`${location}: Select distinct columns with plain-value headings.`);
  }
  if (mapping.account===undefined && (!/^\d[\d -]*$/.test(options.account?.trim()??'') || (options.account??'').replace(/\D/g,'').length<4)) {
   throw new Error(`${location}: Enter the bank account number (at least its last four digits) for this worksheet.`);
  }
  recognized = true;
  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
   const row = sheet.rows[r];
   if (blank(row)) continue;
   const accountCell = mapping.account===undefined ? {value:options.account} : row[mapping.account];
   const dateCell=row[mapping.date], first=row[mapping.description], second=mapping.description2===undefined?undefined:row[mapping.description2], amountCell=row[mapping.amount];
   const description = [text(first), text(second)].filter(Boolean).join(' ').trim();
   const airbnb = /\bAIRBNB\s+PAYMENTS\b/i.test(description) || /^AIRBNB\s+\d+\s+AIRBNB\b/i.test(description);
   const owner = description.match(/e-Transfer\s*[-–]\s*Autodeposit\b\s*(.*)$/i);
   const zelle = /^ZELLE\s+FROM\b/i.test(description);
   if (!airbnb && !owner && !zelle) continue;
   try {
    if (columns.some(c => row[c]?.formula || row[c]?.error)) throw new Error('Formula or error cells cannot be used as bank evidence. Export the original transaction values.');
    if(mapping.status!==undefined && text(row[mapping.status]).trim() && !/^(posted|completed|complete|cleared|settled)$/i.test(text(row[mapping.status]).trim())) throw new Error('Transaction is not confirmed as posted; skipped.');
    if(mapping.debit!==undefined && text(row[mapping.debit]).trim()) {
     const debit=parseMoney(row[mapping.debit]?.value);
     if(debit===null || debit!==0)throw new Error('Transaction has an invalid or nonzero debit amount; skipped.');
    }
    const amountCents = parseMoney(amountCell?.value);
    if (amountCents === null) throw new Error('Missing deposit amount.');
    if (amountCents <= 0) continue;
    const rawAccount = text(accountCell).trim();
    if (!/^\d[\d -]*$/.test(rawAccount) || rawAccount.replace(/\D/g, '').length < 4) throw new Error('Missing or invalid bank account number.');
    const account = rawAccount.replace(/\D/g, '').slice(-4);
    const date = transactionDate(dateCell?.value);
    const explicitReference=mapping.reference===undefined?'':text(row[mapping.reference]).trim();
    if (zelle) {
     const match=description.match(/^ZELLE\s+FROM\s+(.+?)\s+ON\s+\d{1,2}\/\d{1,2}\s+REF\s*#\s*([A-Za-z0-9]+)(?:\s+(.*))?$/i);
     if(!match)throw new Error('Incoming Zelle payment has an unreadable sender or reference.');
     if(explicitReference && explicitReference!==match[2])throw new Error('Conflicting transaction references.');
     const memo=zelleMemo(match[3]??'',date);
     deposits.push({kind:'owner',ownerName:match[1].trim(),account,date,amountCents,reference:match[2],source,...(memo.description?{description:memo.description}:{}),...(memo.propertyReference?{propertyReference:memo.propertyReference}:{}),...(memo.serviceMonth?{serviceMonth:memo.serviceMonth}:{})});
    } else if (owner) {
     const detail = owner[1].trim();
     const candidate = detail.match(/(?:^|\s)([A-Za-z0-9]{6,})$/);
     // Like PDF imports, require a digit so surnames cannot become fabricated references.
     const embeddedReference = candidate && /\d/.test(candidate[1]) ? candidate[1] : '';
     if(explicitReference && embeddedReference && explicitReference!==embeddedReference)throw new Error('Conflicting transaction references.');
     const reference=explicitReference || embeddedReference;
     const ownerName = embeddedReference ? detail.slice(0, candidate!.index).trim() : detail;
     deposits.push({kind:'owner',ownerName,account,date,amountCents,reference,source});
    } else {
     const embeddedReference = description.match(/\bAIRBNB\s+PAYMENTS\s+(\d{10,})\b/i)?.[1] ?? description.match(/\bTRN\*1\*([A-Za-z0-9-]+)/i)?.[1] ?? '';
     if(explicitReference && embeddedReference && explicitReference!==embeddedReference)throw new Error('Conflicting transaction references.');
     const reference=explicitReference || embeddedReference;
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
