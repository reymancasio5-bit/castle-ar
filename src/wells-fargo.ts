import type {BankDeposit} from './bank-statement.ts';
const monthNames=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const iso=(year:number,month:number,day:number)=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
const validDate=(value:string)=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

export function parseWellsFargoStatement(text:string,source:string):{deposits:BankDeposit[];warnings:string[]}{
 const accounts=[...text.matchAll(/Account number\s*:\s*([\d -]+)/gi)].map(m=>m[1].replace(/\D/g,''));
 const dates=[...text.matchAll(/([A-Za-z]+)\s+(\d{1,2}),\s+(20\d{2})\s+Page\s+\d+\s+of\s+\d+/gi)].map(m=>iso(+m[3],monthNames.indexOf(m[1].slice(0,3).toLowerCase())+1,+m[2]));
 if(!accounts.length||accounts[0].length<4||new Set(accounts).size!==1||!dates.length||new Set(dates).size!==1||!validDate(dates[0]))throw new Error('Cannot identify a single Wells Fargo account and statement date. Upload one complete statement at a time.');
 const begin=text.match(/Beginning balance on\s+(\d{1,2})\/(\d{1,2})/i),ending=text.match(/Ending balance on\s+(\d{1,2})\/(\d{1,2})/i);
 const end=dates[0],year=+end.slice(0,4);
 if(!begin||!ending||iso(year,+ending[1],+ending[2])!==end)throw new Error('Cannot identify the Wells Fargo statement period. Include its activity summary.');
 const start=iso(year-(+begin[1]>+ending[1]?1:0),+begin[1],+begin[2]);
 if(!validDate(start)||start>end||Date.parse(end)-Date.parse(start)>62*86400000)throw new Error('Unrecognized Wells Fargo statement period.');
 const account=accounts[0].slice(-4),deposits:BankDeposit[]=[],warnings:string[]=[];
 let pending:{date:string;description:string;credit:string;debit:string}|undefined;
 const flush=()=>{
  if(!pending)return;
  const p=pending;pending=undefined;
  const match=p.description.match(/^Zelle\s+From\s+(.+?)\s+on\s+\d{1,2}\/\d{1,2}\s+Ref\s*#\s*([A-Za-z0-9]+)(?:\s+(.*))?$/i);
  if(!match||!p.date||p.debit.trim()||!/^\d[\d,]*\.\d{2}$/.test(p.credit.trim())){warnings.push('An incoming Zelle payment had an unreadable reference, date, or deposit amount and was skipped.');return;}
  const amountCents=Math.round(Number(p.credit.replace(/,/g,''))*100);
  if(!Number.isSafeInteger(amountCents)||amountCents<=0){warnings.push('An incoming Zelle payment had an invalid deposit amount and was skipped.');return;}
  const description=(match[3]??'').replace(/\\/g,' ').replace(/\s+/g,' ').trim();
  // Preserve the original memo, but separate joined words and remove month/year tokens
  // before looking for an address ("SEP.26 Extra" is not "26 Extra" street).
  const memo=description.replace(/\bAirbnb(?=(?:January|February|March|April|May|June|July|August|September|October|November|December)\b)/i,'Airbnb ');
  const numericMonth=memo.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/);
  const namedMonth=memo.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:[.\s]+(20\d{2}|\d{2})\b)?\b/i);
  const namedIndex=namedMonth?monthNames.indexOf(namedMonth[1].slice(0,3).toLowerCase())+1:0;
  const namedYear=namedMonth?.[2]?Number(namedMonth[2].length===2?'20'+namedMonth[2]:namedMonth[2]):+p.date.slice(0,4)-(namedIndex>+p.date.slice(5,7)?1:0);
  const serviceMonth=numericMonth?`${numericMonth[2]}-${numericMonth[1].padStart(2,'0')}`:namedMonth?`${namedYear}-${String(namedIndex).padStart(2,'0')}`:undefined;
  const addressMemo=memo.replace(numericMonth?.[0]??/^(?!)$/,' ').replace(namedMonth?.[0]??/^(?!)$/,' ');
  const propertyReference=addressMemo.match(/\b(?:Unit\s+)?(\d+[A-Za-z]?\s+(?!(?:Management|Service|Fee|Airbnb|Cohost|Extra)\b)[A-Za-z][A-Za-z0-9 .'-]*?)(?=\s+(?:Service|Management|Fee)\b|$)/i)?.[1]?.trim();
  deposits.push({kind:'owner',ownerName:match[1].trim(),account,date:p.date,amountCents,reference:match[2],source,...(description?{description}:{}),...(propertyReference?{propertyReference}:{}),...(serviceMonth?{serviceMonth}:{})});
 };
 for(const raw of text.split(/\r?\n/)){
  const cells=raw.split('\t'),line=cells[0].trim();
  const date=line.match(/^(\d{1,2})\/(\d{1,2})\s+(.+)/);
  if(date){
   flush();
   if(!/^Zelle\s+From\b/i.test(date[3]))continue;
   const candidates=[...new Set([+start.slice(0,4),year])].map(y=>iso(y,+date[1],+date[2])).filter(d=>validDate(d)&&d>=start&&d<=end);
   pending={date:candidates.length===1?candidates[0]:'',description:date[3],credit:cells[2]??'',debit:cells[1]??''};
  }else if(/^(?:Totals\b|Transaction history|\w+\s+\d+,\s+20\d{2}\s+Page)/i.test(line)){flush();}
  else if(pending&&line)pending.description+=' '+line;
 }
 flush();
 warnings.push('Wells Fargo import includes incoming Zelle From payments only. Zelle To, Airbnb deposits, and other transactions are not imported by this format.');
 return {deposits,warnings};
}
