import type { Change, Month } from './types.ts';
export interface BankDeposit { account: string; date: string; amountCents: number; reference: string; source: string }
const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const cents = (s: string) => Math.round(Number(s.replace(/,/g,''))*100);
export function bankAccount(value: string): string {
 const match=value.match(/(?:checking|chequing|savings)\s+([\d -]+)/i);
 return match ? match[1].replace(/\D/g,'').slice(-4) : '';
}
export function parseStatement(text: string, source = 'Pasted statement'): { deposits: BankDeposit[]; warnings: string[] } {
 const period=text.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})\s+to\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})/i);
 const accountMatch=text.match(/Account number\s*:\s*([\d -]+)/i);
 if(!period || !accountMatch) throw new Error('Include the statement period and account number from the PDF header.');
 const accounts=[...text.matchAll(/Account number\s*:\s*([\d -]+)/gi)].map(m=>m[1].replace(/\D/g,''));
 const periods=[...text.matchAll(/([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})\s+to\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})/gi)].map(m=>m.slice(1).join('|').toLowerCase());
 if(new Set(accounts).size>1||new Set(periods).size>1)throw new Error('Paste one statement at a time; different accounts or periods cannot be combined.');
 const startMonth=months.indexOf(period[1].slice(0,3).toLowerCase()),endMonth=months.indexOf(period[4].slice(0,3).toLowerCase());
 if(startMonth<0||endMonth<0)throw new Error('Unrecognized statement period.');
 const iso=(y:number,m:number,d:number)=>`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 const start=iso(+period[3],startMonth,+period[2]),end=iso(+period[6],endMonth,+period[5]);
 const account=accountMatch[1].replace(/\D/g,'').slice(-4);
 if(account.length!==4)throw new Error('Cannot identify the bank account.');
 const deposits:BankDeposit[]=[],warnings:string[]=[];
 let date='',pending:{date:string;reference:string;amount:number|null}|null=null;
 const flush=()=>{if(pending){if(pending.date&&pending.amount!==null&&pending.amount>0)deposits.push({account,date:pending.date,amountCents:pending.amount,reference:pending.reference,source});else warnings.push('An Airbnb entry had no readable deposit amount or date and was skipped.');pending=null;}};
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim();
  if(!line)continue;
  if(/^\d{1,2}$/.test(line)){flush();date='';continue;}
  const day=line.match(/^(\d{1,2})\s+([A-Za-z]{3})\b/);
  if(day){
   flush();const m=months.indexOf(day[2].toLowerCase());
   const possibilities=[...new Set([+period[3],+period[6]])].map(y=>iso(y,m,+day[1])).filter(d=>m>=0&&d>=start&&d<=end&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d);
   date=possibilities.length===1?possibilities[0]:'';
  }
  const airbnb=/\bAIRBNB\s+PAYMENTS\b/i.test(line);
  if(airbnb){flush();pending={date,reference:'',amount:null};}
  else if(pending && /[A-Za-z]/.test(line) && !/^(?:\d{1,2}\s+[A-Za-z]{3}\s*)?\d[\d,.\s]*$/.test(line)){flush();}
  if(!pending)continue;
  const ref=line.match(/\b\d{10,}\b/);if(ref)pending.reference=ref[0];
  // PDF extraction emits description, debit, credit and balance as tab-separated cells.
  const columns=raw.split('\t');
  const amountText=columns.length>=3?columns[2] : (line.match(/\bCredit:\s*([\d,.]+)/i)?.[1]??'');
  const amount=amountText.match(/(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\b/);
  if(amount)pending.amount=cents(amount[0]);
 }
 flush();return {deposits,warnings};
}
export function matchStatement(deposits: BankDeposit[], month: Month) {
 const changes: Change[]=[];
 const all=month.properties.flatMap(property=>property.payments.map(payment=>({property:property.name,payment})));
 const rows=deposits.map(deposit=>{
  let payments=all.filter(({payment:p})=>p.type==='Airbnb'&&p.bundleCents===deposit.amountCents&&bankAccount(p.bankDetails??'')===deposit.account);
  let status='Ready';
  if(deposits.filter(d=>d.account===deposit.account&&d.amountCents===deposit.amountCents).length>1)status='Ambiguous: repeated deposit amount';
  else if(!payments.length)status='No matching bundle in this month';
  else if(new Set(payments.map(({payment:p})=>p.payoutDate)).size!==1 || payments.some(({payment:p})=>!p.payoutDate||p.payoutDate>deposit.date))status='Needs review: payout dates do not identify one bundle';
  else if(payments.reduce((sum,{payment:p})=>sum+(p.amountCents??0),0)>deposit.amountCents)status='Needs review: matched payments exceed the bundle';
  else if(payments.some(({payment:p})=>p.amountCents===null||p.amountCents<=0||(p.bankCents!==null&&p.bankCents!==p.amountCents)||(p.bankDate!==''&&p.bankDate!==deposit.date)))status='Needs review: existing bank values or missing payment amount';
  else {
   const pending=payments.filter(({payment:p})=>!(p.verifiedBySystem&&p.bankCents===p.amountCents&&p.bankDate===deposit.date));
   if(!pending.length)status='Already verified';
   else pending.forEach(({payment:p})=>changes.push({kind:'reconcileBank',paymentId:p.id,account:deposit.account,bundleCents:deposit.amountCents,bankDate:deposit.date}));
  }
  return {deposit,payments,status};
 });
 return {rows,changes};
}
