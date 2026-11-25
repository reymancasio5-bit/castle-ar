import type { ImportCell, ImportSheet } from './import.ts';
import type { BankDeposit, BankImportExclusion } from './bank-statement.ts';
import type { BankCurrency } from './types.ts';
import {zelleMemo} from './wells-fargo.ts';
import { parseMoney } from './domain.ts';
import { extractRbcOwnerReference } from './rbc-reference.ts';
import { payoutReferences, wellsAirbnbReferences } from './bank-transaction-reference.ts';

export interface BankColumnMapping { headerRow: number; date: number; description: number; amount: number; account?: number; description2?: number; debit?: number; reference?: number; status?: number }
export interface BankSpreadsheetOptions { account?: string; mapping?: BankColumnMapping; currency?: BankCurrency }
const aliases = {
 account: ['account number','account','account no','account no.','account #'],
 date: ['transaction date','date','posted date','posting date'],
 description: ['description 1','description','transaction description','memo','details'],
 description2: ['description 2'],
 amount: ['cad$','usd$','amount','transaction amount','credit','credits','deposit','deposits','credit amount','deposit amount'],
 debit: ['debit','debits','withdrawal','withdrawals','debit amount'],
 reference: ['reference','reference number','transaction id','reference #'],
 status: ['status','transaction status'],
};
const keys = Object.keys(aliases) as (keyof typeof aliases)[];
const required = ['date','description','amount'] as const;
const text = (cell: ImportCell | undefined) => cell?.value == null ? '' : String(cell.value);
const header = (cell: ImportCell | undefined) => text(cell).trim().replace(/\s+/g, ' ').toLowerCase();
const unsafe = (cell: ImportCell | undefined) => Boolean(cell?.formula || cell?.error);
const populated = (cell: ImportCell | undefined) => Boolean(text(cell).trim()) || unsafe(cell);
const blank = (row: ImportCell[]) => !row.some(populated);
const headingCurrency = (heading: string): BankCurrency | undefined => heading === 'cad$' ? 'CAD' : heading === 'usd$' ? 'USD' : undefined;
const currencyHeadings = ['currency','currency code','currencycode','transaction currency','account currency'];

export class AmbiguousBankColumnsError extends Error {}

function bankHeaderRow(sheet: ImportSheet): number {
 const recognized = sheet.rows.findIndex(row => required.every(key => row.some(cell => aliases[key].includes(header(cell)))));
 if (recognized >= 0) return recognized;
 return sheet.rows.findIndex(row => (['date','description'] as const).every(key => row.some(cell => aliases[key].includes(header(cell)))));
}

function inspectBankColumns(sheet: ImportSheet, headerRow: number): { mapping: BankColumnMapping; ambiguity?: string } {
 const headings = sheet.rows[headerRow]?.map(header) ?? [];
 const mapping: BankColumnMapping = {headerRow,date:-1,description:-1,amount:-1};
 let ambiguity: string | undefined;
 for (const key of keys) {
  let matches = headings.flatMap((heading, i) => aliases[key].includes(heading) ? [i] : []);
  if (key === 'amount' && matches.length === 2 && matches.every(i => headingCurrency(headings[i])) && headings[matches[0]] !== headings[matches[1]]) {
   const hasValues = matches.filter(i => sheet.rows.slice(headerRow + 1).some(row => populated(row[i])));
   if (hasValues.length === 1) matches = hasValues;
   else ambiguity ??= 'CAD and USD amount columns are ambiguous. Export one currency per worksheet.';
  }
  if (matches.length === 1) mapping[key] = matches[0];
  if (matches.length > 1) ambiguity ??= `Ambiguous ${key} columns. Export a worksheet with one heading for this field.`;
 }
 return {mapping,ambiguity};
}

export function detectBankColumns(sheet: ImportSheet, selectedRow?: number): BankColumnMapping {
 return inspectBankColumns(sheet, selectedRow ?? Math.max(0, bankHeaderRow(sheet))).mapping;
}

export function bankMappingCurrency(sheet: ImportSheet, mapping: BankColumnMapping): BankCurrency | undefined {
 return bankSheetCurrency(sheet,mapping).currency;
}

function currencyCode(cell: ImportCell | undefined): BankCurrency | undefined {
 const code = text(cell).trim().toUpperCase();
 return !unsafe(cell) && (code === 'CAD' || code === 'USD') ? code : undefined;
}

function bankSheetCurrency(sheet:ImportSheet,mapping:BankColumnMapping): {currency?:BankCurrency;formatCurrency?:BankCurrency;column?:number;requiresValue?:boolean;issue?:string} {
 const headings = sheet.rows[mapping.headerRow];
 if (!headings) return {};
 const columns = headings.flatMap((cell,i) => currencyHeadings.includes(header(cell)) ? [i] : []);
 if (columns.length > 1) return {issue:'Ambiguous currency columns. Export a worksheet with one currency field.'};
 const [column] = columns;
 if (column !== undefined && unsafe(headings[column])) return {issue:'The source currency heading must be a plain value.'};
 let currency = headingCurrency(header(headings[mapping.amount]));
 for (const row of sheet.rows.slice(0,mapping.headerRow)) {
  for (const [i,cell] of row.entries()) {
   const marker = text(cell).trim().match(/^(?:Currency(?:\s*Code)?|(?:Transaction|Account)\s+Currency)(?:\s*:\s*|\s+|$)(.*)$/i);
   if (!marker) continue;
   const code = !unsafe(cell) && currencyCode(marker[1].trim() ? {value:marker[1]} : row[i + 1]);
   if (!code) return {issue:'The source currency must be a plain CAD or USD value.'};
   if (currency && currency !== code) return {issue:'The source currency conflicts with the amount heading or worksheet metadata.'};
   currency = code;
  }
 }
 const codes = new Set<BankCurrency>();
 let formatCurrency:BankCurrency|undefined;
 let allAmountsLabelled = true;
 for (const row of sheet.rows.slice(mapping.headerRow + 1)) {
  if (column !== undefined && populated(row[column])) {
   const code = currencyCode(row[column]);
   if (!code) return {issue:'The source currency must be a plain CAD or USD value.'};
   codes.add(code);
  }
  const amount = row[mapping.amount];
  if (!populated(amount)) continue;
  const formattedCurrency = numericAmountCurrency(amount);
  if (formattedCurrency === 'unsupported') return {issue:'The numeric amount currency must be CAD or USD.'};
  if (formattedCurrency === 'conflicting') return {issue:'The amount display and number format specify conflicting currencies.'};
  if (!formattedCurrency) allAmountsLabelled = false;
  else if (formatCurrency && formatCurrency !== formattedCurrency) return {issue:'Mixed transaction currencies in the amount formats.'};
  else formatCurrency = formattedCurrency;
 }
 if (codes.size > 1) return {issue:'Mixed transaction currencies. Export one currency per worksheet.'};
 const [rowCurrency] = codes;
 if (rowCurrency && currency && rowCurrency !== currency) return {issue:'The transaction currency conflicts with the amount heading or worksheet metadata.'};
 const declaredCurrency = currency ?? rowCurrency;
 if (formatCurrency && declaredCurrency && formatCurrency !== declaredCurrency) return {issue:'The numeric amount currency conflicts with the worksheet currency.'};
 return {currency:declaredCurrency ?? (allAmountsLabelled ? formatCurrency : undefined),formatCurrency,column,requiresValue:!currency && !!rowCurrency};
}

export function validateBankColumnMapping(sheet: ImportSheet, proposal: unknown): BankColumnMapping {
 if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) throw new Error('Invalid bank mapping.');
 const raw = proposal as Record<string, unknown>;
 if (Object.keys(raw).some(key => key !== 'headerRow' && !keys.includes(key as keyof typeof aliases))) throw new Error('Unexpected bank mapping fields.');
 if (typeof raw.headerRow !== 'number' || !Number.isInteger(raw.headerRow) || raw.headerRow < 0 || raw.headerRow >= sheet.rows.length - 1) {
  throw new Error('Select a bank mapping header row above the transactions.');
 }
 const sourceHeader = bankHeaderRow(sheet);
 const {mapping: detected, ambiguity} = inspectBankColumns(sheet, raw.headerRow);
 if (ambiguity) throw new AmbiguousBankColumnsError(ambiguity);
 if (sourceHeader >= 0 && sourceHeader !== raw.headerRow) {
  const source = inspectBankColumns(sheet, sourceHeader);
  if (source.ambiguity) throw new AmbiguousBankColumnsError(source.ambiguity);
  throw new Error('Bank mapping must use the recognized transaction header row.');
 }
 const headings = sheet.rows[raw.headerRow];
 const mapping: BankColumnMapping = {headerRow:raw.headerRow,date:-1,description:-1,amount:-1};
 const used = new Set<number>();
 for (const key of keys) {
  const index = raw[key];
  const mandatory = key === 'date' || key === 'description' || key === 'amount';
  if (index == null && !mandatory) continue;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
   throw new Error('Incomplete bank mapping. Select the transaction date, description, and amount columns.');
  }
  const cell = headings[index];
  if (used.has(index) || typeof cell?.value !== 'string' || !cell.value.trim() || unsafe(cell)) {
   throw new Error('Bank mapping requires distinct columns with plain-value headings.');
  }
  const label = cell.value.trim();
  if (!/\p{L}/u.test(label) || (/^(?:\d{1,4}[-/. ]|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[ .-]+\d)/i.test(label) && Number.isFinite(Date.parse(label)))) {
   throw new Error('Bank mapping must select headings.');
  }
  if (key === 'amount' && /\b(balance|total|debits?|withdrawals?)\b/i.test(label)) {
   throw new Error('Bank mapping cannot use a balance, total, or debit column as a deposit amount.');
  }
  used.add(index);
  mapping[key] = index;
 }
 for (const key of keys) {
  const column = detected[key];
  if (column !== undefined && column >= 0 && mapping[key] !== column) throw new Error(`Bank mapping conflicts with the recognized ${key} column.`);
 }
 const currency = bankSheetCurrency(sheet,mapping);
 if (currency.issue) throw new AmbiguousBankColumnsError(currency.issue);
 if (currency.column !== undefined && used.has(currency.column)) throw new Error('Bank mapping cannot use the source currency column for another field.');
 return mapping;
}

function bankIdentifier(cell: ImportCell | undefined): string {
 if (!cell || unsafe(cell)) return '';
 const value = cell.value;
 if (typeof value === 'string') return value.trim();
 // Excel can discard significant digits from numeric identifiers longer than 15 digits.
 if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= 1e15) return '';
 const digits = String(value);
 const format = cell.format?.trim() ?? '';
 const padded = /^0{1,34}$/.test(format) ? digits.padStart(format.length,'0') : undefined;
 const display = cell.formatted?.trim() ?? padded ?? digits;
 return /^\d+$/.test(display) && display.replace(/^0+(?=\d)/,'') === digits && (!padded || padded === display) ? display : '';
}

function accountDigits(cell: ImportCell | undefined): string {
 const value = bankIdentifier(cell);
 if (!/^\d[\d -]*$/.test(value)) return '';
 const digits = value.replace(/\D/g, '');
 return /^\d{4,34}$/.test(digits) ? digits : '';
}

export function bankSheetAccount(sheet: ImportSheet, mapping: BankColumnMapping): {found: boolean;account: string} {
 const accounts = new Set<string>();
 for (const row of sheet.rows.slice(0, mapping.headerRow)) {
  for (const [i, cell] of row.entries()) {
   const label = text(cell).trim().match(/^Account\s*(?:Number|No\.?|#)(?:\s*:\s*|\s+|$)(.*)$/i);
   if (!label) continue;
   const account = !unsafe(cell) && accountDigits(label[1].trim() ? {value:label[1]} : row[i + 1]);
   if (!account) return {found:true,account:''};
   accounts.add(account);
  }
 }
 return {found:accounts.size > 0,account:accounts.size === 1 ? [...accounts][0] : ''};
}

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

function readAmount(cell: ImportCell | undefined): {cents: number | null;issue?: string} {
 try {
  const value = cell?.value;
  const cents = parseMoney(value);
  if (cents === null) return {cents};
  const decimals = typeof value === 'string' ? /\.(\d+)\s*\)?\s*$/.exec(value)?.[1] : undefined;
  const fractional = typeof value === 'number'
   ? Math.abs(value * 100 - cents) > Math.max(1, Math.abs(cents)) * Number.EPSILON * 4
   : /[1-9]/.test(decimals?.slice(2) ?? '');
  return fractional ? {cents:null,issue:'The transaction amount contains fractional cents.'} : {cents};
 } catch (error) {
  return {cents:null,issue:error instanceof Error ? error.message : 'Invalid transaction amount.'};
 }
}

type AmountCurrency = BankCurrency | 'unsupported' | 'conflicting';

function currencyLabel(value: string): Exclude<AmountCurrency,'conflicting'> | undefined {
 const label = value.trim().toUpperCase();
 if (['CAD','CAD$','C$','CA$'].includes(label)) return 'CAD';
 if (['USD','USD$','US$'].includes(label)) return 'USD';
 if (/^(?:[A-Z]{3}|[A-Z]+\$|[€£¥₹₩₽₪₫₦])$/.test(label)) return 'unsupported';
 return undefined;
}

function numericAmountCurrency(cell: ImportCell | undefined): AmountCurrency | undefined {
 if (typeof cell?.value !== 'number' || unsafe(cell)) return undefined;
 const display = cell.formatted ?? '';
 const prefix = /^\s*[(-+−]*\s*([A-Z]+\$|[A-Z]{3}|[€£¥₹₩₽₪₫₦])(?=\s*[\d.,])/i.exec(display)?.[1] ?? '';
 const suffix = /[\d.,]\s*([A-Z]+\$|[A-Z]{3}|[€£¥₹₩₽₪₫₦])\s*[)\-]?\s*$/i.exec(display)?.[1] ?? '';
 const labels = [prefix,suffix];
 for (const match of (cell.format ?? '').matchAll(/"([^"]*)"|\[\$([^-\]]*)(?:-[^\]]+)?\]|([€£¥₹₩₽₪₫₦])/g)) {
  labels.push(match[1] ?? match[2] ?? match[3]);
 }
 const currencies = new Set(labels.map(currencyLabel).filter(code => code !== undefined));
 return currencies.size > 1 ? 'conflicting' : [...currencies][0];
}

function amountCurrency(cell: ImportCell | undefined): AmountCurrency | undefined {
 if (typeof cell?.value !== 'string') return numericAmountCurrency(cell);
 const prefix = /^\s*[(+-]?\s*(CAD|C\$|USD|US\$|€|£)/i.exec(cell.value)?.[1].toUpperCase();
 if (prefix === '€' || prefix === '£') return 'unsupported';
 return prefix === 'CAD' || prefix === 'C$' ? 'CAD' : prefix === 'USD' || prefix === 'US$' ? 'USD' : undefined;
}

export function parseBankSpreadsheet(sheets: ImportSheet[], source: string, options: BankSpreadsheetOptions = {}): { deposits: BankDeposit[]; warnings: string[]; excluded: BankImportExclusion[] } {
 const deposits: BankDeposit[] = [], warnings: string[] = [], excluded: BankImportExclusion[] = [];
 let recognized = false;
 for (const sheet of sheets) {
  const location = `${source} / ${sheet.name}`;
  if (sheet.error) throw new Error(`${location}: ${sheet.error}`);
  if (sheet.rows.every(blank)) continue;
  let mapping: BankColumnMapping;
  try { mapping = validateBankColumnMapping(sheet, options.mapping ?? detectBankColumns(sheet)); }
  catch (error) { throw new Error(`${location}: ${error instanceof Error ? error.message : 'Invalid bank mapping.'}`); }
  const {headerRow} = mapping;
  const columns = keys.flatMap(key => mapping[key] === undefined ? [] : [mapping[key]]);
  const sourceCurrency = bankSheetCurrency(sheet,mapping);
  if (options.currency !== undefined && options.currency !== 'CAD' && options.currency !== 'USD') {
   throw new Error(`${location}: Select CAD or USD as the transaction currency.`);
  }
  const knownCurrency = sourceCurrency.currency ?? sourceCurrency.formatCurrency;
  if (knownCurrency && options.currency && knownCurrency !== options.currency) throw new Error(`${location}: The selected currency conflicts with the worksheet currency.`);
  const worksheetCurrency = sourceCurrency.currency ?? options.currency;
  const metadata = bankSheetAccount(sheet,mapping);
  if (metadata.found && !metadata.account) throw new Error(`${location}: The worksheet has conflicting or unreadable source account numbers.`);
  let worksheetAccount = '';
  if (mapping.account === undefined) {
   const entered = accountDigits({value:options.account});
   if (metadata.account && entered && metadata.account !== entered && (metadata.account.length > 4 || !entered.endsWith(metadata.account))) {
    throw new Error(`${location}: The entered bank account conflicts with the account on the worksheet.`);
   }
   worksheetAccount = entered || metadata.account;
   if (!worksheetAccount) throw new Error(`${location}: Enter the bank account number for this worksheet.`);
  }

  recognized = true;
  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
   const row = sheet.rows[r];
   if (blank(row)) continue;
   const amountCell = row[mapping.amount], debitCell = mapping.debit === undefined ? undefined : row[mapping.debit];
   const amount = readAmount(amountCell), debit = readAmount(debitCell);
   if (!unsafe(amountCell) && amount.cents !== null && amount.cents <= 0) continue;
   if (!populated(amountCell) && !unsafe(debitCell) && debit.cents !== null && debit.cents !== 0) continue;

   const first = row[mapping.description], second = mapping.description2 === undefined ? undefined : row[mapping.description2];
   const description = [text(first),text(second)].filter(Boolean).join(' ');
   const classifiedText = description.trim();
   const rbcAirbnb = /^(?:Account Payable Pmt\s+)?AIRBNB\s+PAYMENTS(?=\s|\d|$)/i.exec(classifiedText);
   const wellsAirbnb = /^AIRBNB\s+\d+\s+AIRBNB\b/i.test(classifiedText);
   const owner = classifiedText.match(/^e-Transfer\s*[-–]\s*Autodeposit\b\s*(.*)$/i);
   const zelle = /^ZELLE\s+FROM\b/i.test(classifiedText);
   const rowCurrency = amountCurrency(amountCell);
   const missingCurrency = sourceCurrency.requiresValue && sourceCurrency.column !== undefined && !currencyCode(row[sourceCurrency.column]);
   const currency = rowCurrency === 'unsupported' || rowCurrency === 'conflicting' || missingCurrency ? undefined : rowCurrency ?? worksheetCurrency;
   const rowAccount = mapping.account === undefined ? worksheetAccount : accountDigits(row[mapping.account]);
   const accountConflict = rowAccount && metadata.account && rowAccount !== metadata.account &&
    (rowAccount.length > 4 && metadata.account.length > 4 || rowAccount.slice(-4) !== metadata.account.slice(-4));
   const digits = !accountConflict && rowAccount.length === 4 && metadata.account.length > 4 ? metadata.account : rowAccount;
   const account = digits ? digits.slice(-4) : undefined;
   const accountIdentity = digits.length > 4 ? digits : undefined;
   const referenceCell = mapping.reference === undefined ? undefined : row[mapping.reference];
   const explicitReference = bankIdentifier(referenceCell);
   let date: string | undefined;
   try { date = transactionDate(row[mapping.date]?.value); } catch { /* The exclusion carries the source row and recoverable fields. */ }
   const details = {source,sheet:sheet.name,sourceRow:r + 1,description,...(date ? {date} : {}),...(currency ? {currency} : {}),...(account ? {account} : {}),...(accountIdentity ? {accountIdentity} : {}),...(explicitReference ? {reference:explicitReference} : {})};
   const amountCents = amount.cents !== null && amount.cents > 0 ? amount.cents : null;
   try {
    if (columns.some(c => unsafe(row[c]))) throw new Error('Formula or error cells cannot be used as bank evidence. Export the original transaction values.');
    if (mapping.status !== undefined && !/^(posted|completed|complete|cleared|settled)$/i.test(text(row[mapping.status]).trim())) {
     throw new Error('Transaction is not confirmed as posted.');
    }
    if (debit.issue || (debit.cents !== null && debit.cents !== 0)) throw new Error('Transaction has an invalid or nonzero debit amount.');
    if (amountCents === null) throw new Error(amount.issue ?? 'Missing deposit amount.');
    if (rowCurrency === 'unsupported') throw new Error('Transaction currency must be CAD or USD.');
    if (rowCurrency === 'conflicting') throw new Error('The amount display and number format specify conflicting currencies.');
    if (missingCurrency) throw new Error('The transaction currency is missing from the source currency column.');
    if (rowCurrency && worksheetCurrency && rowCurrency !== worksheetCurrency) throw new Error('Transaction currency conflicts with the worksheet currency.');
    if (!account) throw new Error('Missing or invalid bank account number.');
    if (accountConflict) throw new Error('Transaction account conflicts with the account on the worksheet.');
    if (!date) throw new Error('Missing or invalid transaction date.');
    if (!classifiedText) throw new Error('Missing bank transaction description.');
    if (populated(referenceCell) && !explicitReference) throw new Error('The transaction reference cannot be read exactly. Export identifiers as text.');
    if (/^(?:Zelle\s+To|e-Transfer sent|Withdrawal)\b/i.test(classifiedText)) throw new Error('An outgoing transaction description conflicts with the positive amount.');

    const evidence = {...details,account,date,amountCents};
    if (rbcAirbnb || wellsAirbnb) {
     const references = rbcAirbnb ? payoutReferences(classifiedText.slice(rbcAirbnb[0].length),true)
      : [...new Set([...wellsAirbnbReferences(classifiedText),...payoutReferences(classifiedText)])];
     if (references.length > 1) throw new Error('Conflicting transaction references.');
     const reference = checkedReference(explicitReference,references[0] ?? '');
     deposits.push({...evidence,platform:'Airbnb',reference});
    } else if (owner) {
     const {ownerName,reference} = extractRbcOwnerReference(owner[1]);
     deposits.push({...evidence,kind:'owner',ownerName,reference:checkedReference(explicitReference,reference)});
    } else if (zelle) {
     const match = classifiedText.match(/^ZELLE\s+FROM\s+(.+?)\s+ON\s+\d{1,2}\/\d{1,2}\s+REF\s*#\s*([A-Za-z0-9]+)(?:\s+(.*))?$/i);
     if (!match) throw new Error('Incoming Zelle payment has an unreadable sender or reference.');
     const memo = zelleMemo(match[3] ?? '',date);
     deposits.push({...evidence,kind:'owner',ownerName:match[1].trim(),reference:checkedReference(explicitReference,match[2]),description:memo.description || undefined,sourceDescription:description,...(memo.propertyReference ? {propertyReference:memo.propertyReference} : {}),...(memo.serviceMonth ? {serviceMonth:memo.serviceMonth} : {})});
    } else {
     excluded.push({...details,amountCents,reason:'This credit does not match a supported bank payment description.',reviewable:Boolean(accountIdentity && currency)});
    }
   } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unreadable bank transaction.';
    warnings.push(`${location}, row ${r + 1}: ${reason}`);
    excluded.push({...details,amountCents,reason});
   }
  }
 }
 if (!recognized) throw new Error(`${source}: No bank transaction worksheet was found.`);
 return {deposits,warnings,excluded};
}

function checkedReference(explicit: string, embedded: string): string {
 if (explicit && embedded && explicit !== embedded) throw new Error('Conflicting transaction references.');
 return explicit || embedded;
}
