import type {BankDeposit,BankImportExclusion} from './bank-statement.ts';

export const statementMonths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export const isoBankDate = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
export const validBankDate = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

export type StatementIdentity = Pick<BankDeposit,'source' | 'account' | 'accountIdentity' | 'currency'>;
type StatementLocation = Pick<BankDeposit,'sheet' | 'sourceRow'>;
export interface StatementLine extends StatementLocation {
 description: string;
 credit: string;
 debit: string;
 pageBreak: boolean;
}
export interface PdfTransaction extends StatementLocation {
 date?: string;
 lines: string[];
 credit: string;
 debit: string;
}

function statementCurrency(text: string): BankDeposit['currency'] {
 const code = '(CAD|USD|Canadian Dollars?|U\\.?S\\.? Dollars?)';
 const currencyLabels = new RegExp(`^\\s*(?:(?:Account )?Currency\\s*:\\s*${code}\\$?|.*\\bDeposits\\s*&\\s*Credits\\s*\\(\\s*${code}\\s*\\$?\\s*\\).*?)\\s*$`, 'i');
 const currencies = new Set(text.split(/\r?\n/).flatMap(line => {
  const match = line.match(currencyLabels);
  if (!match) return [];
  return [/(?:^CAD$|Canadian)/i.test(match[1] ?? match[2]) ? 'CAD' as const : 'USD' as const];
 }));
 if (currencies.size > 1) throw new Error('The PDF gives conflicting account currencies. Use a statement for one account and currency.');
 return [...currencies][0];
}

export function statementIdentity(text: string, source: string, accountIdentity: string): StatementIdentity {
 const currency = statementCurrency(text);
 return {source,account:accountIdentity.slice(-4),accountIdentity,...(currency ? {currency} : {})};
}

export function* statementLines(text: string): Generator<StatementLine> {
 let sheet: string | undefined;
 let sourceRow = 0;
 for (const raw of text.split(/\r?\n/)) {
  const page = raw.trim().match(/^===== PAGE (\d+) =====$/);
  if (page) {
   sheet = `Page ${page[1]}`;
   sourceRow = 0;
   yield {pageBreak:true,description:'',credit:'',debit:''};
   continue;
  }
  sourceRow++;
  const cells = raw.split('\t');
  const pastedCredit = cells.length === 1 ? raw.match(/^(.*?)\bCredit:\s*(.*)$/i) : null;
  const description = (pastedCredit?.[1] ?? cells[0]).trim();
  const credit = (cells[2] ?? pastedCredit?.[2] ?? '').trim();
  const debit = (cells[1] ?? '').trim();
  if (description || credit || debit) yield {description,credit,debit,sourceRow,...(sheet ? {sheet} : {}),pageBreak:false};
 }
}

export function statementDate(start: string, end: string, month: number, day: number): string | undefined {
 const years = new Set([Number(start.slice(0,4)),Number(end.slice(0,4))]);
 const dates = [...years].map(year => isoBankDate(year,month,day)).filter(date => validBankDate(date) && date >= start && date <= end);
 return dates.length === 1 ? dates[0] : undefined;
}

export function startPdfTransaction(line: StatementLine, description: string, date?: string): PdfTransaction {
 return {sourceRow:line.sourceRow,...(line.sheet ? {sheet:line.sheet} : {}),date,lines:description ? [description] : [],credit:line.credit,debit:line.debit};
}

export function appendPdfLine(transaction: PdfTransaction, line: StatementLine): void {
 if (line.description) transaction.lines.push(line.description);
 if (line.credit) transaction.credit = line.credit;
 if (line.debit) transaction.debit = line.debit;
}

function amountCents(value: string): number | null {
 const match = value.match(/^(-|\()?\s*\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+))\.(\d{2})\s*(\))?$/);
 if (!match || (match[1] === '(') !== !!match[4]) return null;
 const cents = Number(match[2].replace(/,/g,''))*100 + Number(match[3]);
 if (!Number.isSafeInteger(cents)) return null;
 return match[1] ? -cents : cents;
}

type CreditEvidence = Omit<BankImportExclusion,'reason' | 'reviewable'>;
type CheckedCredit = {evidence: CreditEvidence; invalid: string} | {evidence: CreditEvidence & {date: string; amountCents: number}};

export function readPdfCredit(transaction: PdfTransaction, identity: StatementIdentity, knownIncoming: boolean): CheckedCredit | undefined {
 if (!transaction.credit && (!knownIncoming || transaction.debit)) return;
 const amount = amountCents(transaction.credit);
 if (amount !== null && amount <= 0) return;
 const {sourceRow,sheet,date} = transaction;
 const evidence: CreditEvidence = {...identity,sourceRow,...(sheet ? {sheet} : {}),...(date ? {date} : {}),description:transaction.lines.join('\n'),amountCents:amount};
 if (transaction.debit) return {evidence,invalid:'The credit also has a debit amount.'};
 if (amount === null) return {evidence,invalid:'The credit amount is missing or unreadable.'};
 if (!date) return {evidence,invalid:'The posting date is missing, invalid, or outside the statement period.'};
 return {evidence:{...evidence,date,amountCents:amount}};
}
