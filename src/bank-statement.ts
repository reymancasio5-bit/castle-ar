import {parseWellsFargoStatement} from './wells-fargo.ts';
import {appendPdfLine,isoBankDate,readPdfCredit,startPdfTransaction,statementDate,statementIdentity,statementLines,statementMonths,validBankDate,type PdfTransaction} from './bank-pdf-transactions.ts';
import {payoutReference} from './bank-transaction-reference.ts';
import {extractRbcOwnerReference,isRbcOwnerReference} from './rbc-reference.ts';
export interface BankDeposit {
 kind?: 'owner';
 ownerName?: string;
 description?: string;
 sourceDescription?: string;
 propertyReference?: string;
 serviceMonth?: string;
 account: string;
 accountIdentity?: string;
 currency?: 'CAD' | 'USD';
 platform?: 'Airbnb' | 'Vrbo';
 date: string;
 amountCents: number;
 reference: string;
 source: string;
 sheet?: string;
 sourceRow?: number;
}
export interface BankImportExclusion {
 source: string;
 sheet?: string;
 sourceRow?: number;
 date?: string;
 amountCents: number | null;
 currency?: 'CAD' | 'USD';
 account?: string;
 accountIdentity?: string;
 description: string;
 reference?: string;
 reason: string;
 reviewable?: boolean;
}
export interface BankImportResult {
 deposits: BankDeposit[];
 warnings: string[];
 excluded?: BankImportExclusion[];
}

const rbcPeriod = /([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})\s+to\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})/gi;
const accountsPattern = /Account number\s*:\s*([\d -]+)/gi;
const dayPattern = /^(\d{1,2})\s+([A-Za-z]{3})(?:\s+|$)/;
const ownerPattern = /^e-Transfer\s*[-\u2013]\s*Autodeposit\b\s*/i;
const airbnbPattern = /^(?:Account Payable Pmt\s+)?AIRBNB\s+PAYMENTS\b/i;
const vrboPattern = /^(?:Misc(?:ellaneous)? Payment\s+)?VRBO\b/i;
const outgoingPattern = /^(?:e-Transfer sent|Zelle to|Withdrawal)\b/i;
const tableBoundary = /^(?:Business Account Statement|Account number\s*:|Account Activity Details|Date Description|(?:Opening|Closing) balance|Account Fees:|\d+\s+of\s+\d+$)/i;
const payoutContinuation = /^(?:\d{10,}$|(?:Ref(?:erence)?\s*[:#]|TRN\*1\*)\s*[A-Za-z0-9-]+[\\]?$)/i;
const transactionWords = /\b(?:credit|deposit|fee|interest|withdrawal|payment|balance|transfer|purchase|refund|adjustment|reversal)\b/i;

export function bankAccount(value: string): string {
 const account = value.match(/(?:checking|chequing|savings)\s+([\d -]+)/i)?.[1];
 return account?.replace(/\D/g,'').slice(-4) ?? '';
}

export function parseStatement(text: string, source = 'Pasted statement'): BankImportResult {
 if (/^\s*Wells\s+Fargo\b/im.test(text)) return parseWellsFargoStatement(text,source);
 const accounts = [...text.matchAll(accountsPattern)].map(match => match[1].replace(/\D/g,''));
 const periods = [...text.matchAll(rbcPeriod)];
 if (!accounts.length || !periods.length) throw new Error('Include the statement period and account number from the PDF header.');
 if (new Set(accounts).size > 1 || new Set(periods.map(match => match.slice(1).join('|').toLowerCase())).size > 1) {
  throw new Error('Paste one statement at a time; different accounts or periods cannot be combined.');
 }
 if (accounts[0].length < 4) throw new Error('Cannot identify the bank account.');
 const [,startName,startDay,startYear,endName,endDay,endYear] = periods[0];
 const start = isoBankDate(+startYear,statementMonths.indexOf(startName.slice(0,3).toLowerCase())+1,+startDay);
 const end = isoBankDate(+endYear,statementMonths.indexOf(endName.slice(0,3).toLowerCase())+1,+endDay);
 if (!validBankDate(start) || !validBankDate(end) || start > end) throw new Error('Unrecognized statement period.');
 const identity = statementIdentity(text,source,accounts[0]);
 const deposits: BankDeposit[] = [];
 const excluded: BankImportExclusion[] = [];
 let postingDate: string | undefined;
 let pending: PdfTransaction | undefined;

 const flush = () => {
  if (!pending) return;
  const transaction = pending;
  pending = undefined;
  const head = transaction.lines[0] ?? '';
  const owner = ownerPattern.test(head);
  const platform = airbnbPattern.test(head) ? 'Airbnb' : vrboPattern.test(head) ? 'Vrbo' : undefined;
  const credit = readPdfCredit(transaction,identity,owner || !!platform);
  if (!credit) return;
  if ('invalid' in credit) {
   excluded.push({...credit.evidence,reason:credit.invalid});
   return;
  }
  const {evidence} = credit;
  const {date,amountCents,description,sourceRow,sheet} = evidence;
  const base = {...identity,date,amountCents,description,sourceDescription:description,sourceRow,...(sheet ? {sheet} : {})};
  if (owner) {
   const detail = transaction.lines.join(' ').replace(ownerPattern,'');
   const {ownerName,reference} = extractRbcOwnerReference(detail);
   deposits.push({...base,kind:'owner',ownerName,reference});
  } else if (platform) {
   const reference = payoutReference(description.replace(airbnbPattern,'').replace(vrboPattern,''),platform === 'Airbnb');
   if (platform === 'Vrbo' && !reference) {
    excluded.push({...evidence,reason:'The VRBO credit has no unambiguous payout reference.',reviewable:true});
   } else {
    deposits.push({...base,platform,reference});
   }
  } else {
   excluded.push({...evidence,reason:'Unsupported incoming transaction description.',reviewable:!!head && !payoutContinuation.test(head) && !outgoingPattern.test(head)});
  }
 };

 for (const line of statementLines(text)) {
  const {description,credit,debit,pageBreak} = line;
  if (pageBreak || tableBoundary.test(description) || /^\d{1,2}$/.test(description)) {
   flush();
   postingDate = undefined;
   continue;
  }
  const day = description.match(dayPattern);
  if (day) {
   flush();
   const rest = description.slice(day[0].length);
   // PDF extraction can repeat the first posting date on a continuation page.
   const duplicate = rest.match(dayPattern);
   const repeats = duplicate && +duplicate[1] === +day[1] && duplicate[2].toLowerCase() === day[2].toLowerCase();
   postingDate = !duplicate || repeats ? statementDate(start,end,statementMonths.indexOf(day[2].toLowerCase())+1,+day[1]) : undefined;
   pending = startPdfTransaction(line,repeats ? rest.slice(duplicate[0].length) : rest,postingDate);
   continue;
  }

  const head = pending?.lines[0] ?? '';
  const ownerContinued = ownerPattern.test(head) && (
   isRbcOwnerReference(description) ||
   (/^Ref(?:erence)?\s*[:#]/i.test(description) && !!extractRbcOwnerReference(description).reference) ||
   (!head.replace(ownerPattern,'').trim() && !transactionWords.test(description))
  );
  const amountContinued = pending && !pending.credit && !pending.debit && payoutContinuation.test(description);
  const payoutContinued = (airbnbPattern.test(head) || vrboPattern.test(head)) && payoutContinuation.test(description);
  const newRecognized = ownerPattern.test(description) || airbnbPattern.test(description) || vrboPattern.test(description);
  const continuation = !newRecognized && (ownerContinued || payoutContinued || amountContinued || !description);
  if (pending && continuation && !(credit && pending.credit) && !(debit && pending.debit)) {
   appendPdfLine(pending,line);
   continue;
  }
  flush();
  if (postingDate || credit || debit || newRecognized) {
   pending = startPdfTransaction(line,description,postingDate);
  }
 }
 flush();
 return {deposits,warnings:[],excluded};
}

export {matchStatement} from './bank-reconciliation.ts';
