import type {BankDeposit,BankImportExclusion,BankImportResult} from './bank-statement.ts';
import {appendPdfLine,isoBankDate,readPdfCredit,startPdfTransaction,statementDate,statementIdentity,statementLines,statementMonths,validBankDate,type PdfTransaction} from './bank-pdf-transactions.ts';
import {payoutReference,wellsAirbnbReference} from './bank-transaction-reference.ts';

const zelleIncoming = /^Zelle\s+From\b/i;
const platformAirbnb = /^Airbnb\s+\d+\s+Airbnb\b/i;
const platformVrbo = /^(?:Misc(?:ellaneous)? Payment\s+)?VRBO\b/i;
const outgoing = /^(?:Zelle\s+To|Online Transfer to|Withdrawal)\b/i;
const tableBoundary = /^(?:Totals\b|Transaction history|[A-Za-z]+\s+\d+,\s+20\d{2}\s+Page|Summary of checks written|The Ending Daily Balance)\b/i;

export function parseWellsFargoStatement(text: string, source: string): BankImportResult {
 const accounts = [...text.matchAll(/Account number\s*:\s*([\d -]+)/gi)].map(match => match[1].replace(/\D/g,''));
 const dates = [...text.matchAll(/([A-Za-z]+)\s+(\d{1,2}),\s+(20\d{2})\s+Page\s+\d+\s+of\s+\d+/gi)].map(
  match => isoBankDate(+match[3],statementMonths.indexOf(match[1].slice(0,3).toLowerCase())+1,+match[2])
 );
 if (!accounts.length || accounts[0].length < 4 || new Set(accounts).size !== 1 || !dates.length || new Set(dates).size !== 1 || !validBankDate(dates[0])) {
  throw new Error('Cannot identify a single Wells Fargo account and statement date. Upload one complete statement at a time.');
 }
 const begin = text.match(/Beginning balance on\s+(\d{1,2})\/(\d{1,2})/i);
 const ending = text.match(/Ending balance on\s+(\d{1,2})\/(\d{1,2})/i);
 const end = dates[0];
 const year = +end.slice(0,4);
 if (!begin || !ending || isoBankDate(year,+ending[1],+ending[2]) !== end) {
  throw new Error('Cannot identify the Wells Fargo statement period. Include its activity summary.');
 }
 const start = isoBankDate(year-(+begin[1] > +ending[1] ? 1 : 0),+begin[1],+begin[2]);
 if (!validBankDate(start) || start > end || Date.parse(end)-Date.parse(start) > 62*86400000) throw new Error('Unrecognized Wells Fargo statement period.');
 const identity = statementIdentity(text,source,accounts[0]);
 const deposits: BankDeposit[] = [];
 const excluded: BankImportExclusion[] = [];
 let pending: PdfTransaction | undefined;

 const flush = () => {
  if (!pending) return;
  const transaction = pending;
  pending = undefined;
  const head = transaction.lines[0] ?? '';
  const owner = zelleIncoming.test(head);
  const platform = platformAirbnb.test(head) ? 'Airbnb' : platformVrbo.test(head) ? 'Vrbo' : undefined;
  const credit = readPdfCredit(transaction,identity,owner || !!platform);
  if (!credit) return;
  if ('invalid' in credit) {
   excluded.push({...credit.evidence,reason:credit.invalid});
   return;
  }

  const {evidence} = credit;
  const {date,amountCents,description:sourceDescription,sourceRow,sheet} = evidence;
  const base = {...identity,date,amountCents,sourceDescription,sourceRow,...(sheet ? {sheet} : {})};
  if (owner) {
   const description = transaction.lines.join(' ');
   const zelle = description.match(/^Zelle\s+From\s+(.+?)\s+on\s+\d{1,2}\/\d{1,2}\s+Ref\s*#\s*([A-Za-z0-9]+)(?:\s+(.*))?$/i);
   if (!zelle) {
    excluded.push({...evidence,reason:'The incoming Zelle payment has an unreadable sender or reference.'});
    return;
   }
   const memo = zelleMemo(zelle[3] ?? '',date);
   deposits.push({...base,kind:'owner',ownerName:zelle[1].trim(),reference:zelle[2],...(memo.description ? memo : {})});
  } else if (platform) {
   const reference = platform === 'Airbnb' ? wellsAirbnbReference(sourceDescription) : payoutReference(sourceDescription);
   if (!reference) {
    excluded.push({...evidence,reason:`The ${platform} credit has no unambiguous payout reference.`,...(platform === 'Vrbo' ? {reviewable:true} : {})});
    return;
   }
   deposits.push({...base,platform,reference,description:sourceDescription});
  } else {
   excluded.push({...evidence,reason:'Unsupported incoming transaction description.',reviewable:!!head && !outgoing.test(head)});
  }
 };

 for (const line of statementLines(text)) {
  if (line.pageBreak || tableBoundary.test(line.description)) {
   flush();
   continue;
  }
  const posting = line.description.match(/^(\d{1,2})\/(\d{1,2})(?:\s+|$)/);
  if (posting) {
   flush();
   const date = statementDate(start,end,+posting[1],+posting[2]);
   pending = startPdfTransaction(line,line.description.slice(posting[0].length),date);
  } else if (pending && ((!line.credit && !line.debit) || (!pending.credit && !pending.debit))) {
   appendPdfLine(pending,line);
  } else if (line.credit || line.debit) {
   flush();
   pending = startPdfTransaction(line,line.description);
  }
 }
 flush();
 return {deposits,warnings:[],excluded};
}

export function zelleMemo(raw:string,date:string){
  const description=raw.replace(/\\/g,' ').replace(/\s+/g,' ').trim();
  // Preserve the original memo, but separate joined words and remove month/year tokens
  // before looking for an address ("SEP.26 Extra" is not "26 Extra" street).
  const memo=description.replace(/\bAirbnb(?=(?:January|February|March|April|May|June|July|August|September|October|November|December)\b)/i,'Airbnb ');
  const numericMonth=memo.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/);
  const namedMonth=memo.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:[.\s]+(20\d{2}|\d{2})\b)?\b/i);
  const namedIndex=namedMonth?statementMonths.indexOf(namedMonth[1].slice(0,3).toLowerCase())+1:0;
  const namedYear=namedMonth?.[2]?Number(namedMonth[2].length===2?'20'+namedMonth[2]:namedMonth[2]):+date.slice(0,4)-(namedIndex>+date.slice(5,7)?1:0);
  const serviceMonth=numericMonth?`${numericMonth[2]}-${numericMonth[1].padStart(2,'0')}`:namedMonth?`${namedYear}-${String(namedIndex).padStart(2,'0')}`:undefined;
  const addressMemo=memo.replace(numericMonth?.[0]??/^(?!)$/,' ').replace(namedMonth?.[0]??/^(?!)$/,' ');
  const propertyReference=addressMemo.match(/\b(?:Unit\s+)?(\d+[A-Za-z]?\s+(?!(?:Management|Service|Fee|Airbnb|Cohost|Extra)\b)[A-Za-z][A-Za-z0-9 .'-]*?)(?=\s+(?:Service|Management|Fee)\b|$)/i)?.[1]?.trim();
 return {description,propertyReference,serviceMonth};
}
