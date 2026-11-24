import type {AssistantRequest,AssistantReply,BankMappingSample} from './assistant-types.ts';
import type {ImportSheet} from './import.ts';
import type {Month} from './types.ts';
import {bankAccount} from './bank-statement.ts';
import {detectBankColumns,parseBankSpreadsheet,type BankColumnMapping} from './bank-spreadsheet.ts';

export type BankMappingAssistant=(request:AssistantRequest,onProgress?:(label:string)=>void)=>Promise<AssistantReply>;
export interface PreparedBankSheet {source:string;sheet:ImportSheet;mapping:BankColumnMapping;account:string;method:'ai'|'automatic';note:string;issue?:string;excluded?:boolean}
const keys=['headerRow','date','description','amount','account','description2','debit','reference','status'] as const;
const required=['headerRow','date','description','amount'];

export function validateBankMapping(sheet:ImportSheet,proposal:unknown):BankColumnMapping {
 if(!proposal||typeof proposal!=='object'||Array.isArray(proposal))throw new Error('Invalid bank mapping response.');
 const raw=proposal as Record<string,unknown>;
 if(Object.keys(raw).some(key=>!keys.includes(key as typeof keys[number])))throw new Error('Unexpected bank mapping fields.');
 const mapping={} as BankColumnMapping;
 for(const key of keys){
  const value=raw[key];
  if(value==null&&!required.includes(key))continue;
  if(!Number.isInteger(value)||Number(value)<0)throw new Error('Incomplete bank mapping.');
  mapping[key]=Number(value);
 }
 const headings=sheet.rows[mapping.headerRow];
 if(!headings||mapping.headerRow>=sheet.rows.length-1)throw new Error('Invalid bank mapping header row.');
 if(/\b(balance|total|debit|withdrawals?)\b/i.test(String(headings[mapping.amount]?.value??'')))throw new Error('Bank mapping cannot use a balance, total, or debit column as a deposit amount.');
 const original=detectBankColumns(sheet);
 if(original.date>=0&&original.description>=0&&original.amount>=0&&original.headerRow!==mapping.headerRow)throw new Error('AI mapping cannot skip the recognized transaction header.');
 const used=new Set<number>();
 for(const key of keys.filter(key=>key!=='headerRow')){
  const col=mapping[key];if(col===undefined)continue;
  if(used.has(col)||!headings[col]||typeof headings[col].value!=='string'||!String(headings[col].value).trim()||headings[col].formula||headings[col].error)throw new Error('Invalid or reused bank mapping column.');
  const label=String(headings[col].value).trim();
  if(!/\p{L}/u.test(label)||/^(?:\d{1,4}[-/. ]|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[ .-]+\d)/i.test(label)&&Number.isFinite(Date.parse(label)))throw new Error('Bank mapping must select headings, not transaction values.');
  used.add(col);
 }
 // A model cannot remove or reinterpret a known debit/status/account control.
 const detected=detectBankColumns(sheet,mapping.headerRow);
 for(const key of keys.filter(key=>key!=='headerRow')){
  const column=detected[key];
  if(column!==undefined&&column>=0&&mapping[key]!==column)throw new Error(`AI mapping conflicts with the recognized ${key} column.`);
 }
 return mapping;
}

export function bankMappingSample(sheet:ImportSheet,source:string):BankMappingSample {
 const rows:string[][]=[];
 for(const row of sheet.rows.slice(0,60)){
  if(row.length>60)throw new Error('This worksheet has too many columns for automatic interpretation. Export the transaction table only.');
  const values=row.map(cell=>String(cell.value??'').slice(0,600));
  if(JSON.stringify([...rows,values]).length>22000)break;
  rows.push(values);
 }
 if(rows.length<2)throw new Error('Not enough transaction rows to interpret this worksheet.');
 return {source:source.slice(0,240),sheet:sheet.name.slice(0,120),rows,totalRows:sheet.rows.length};
}

function sourceAccount(sheet:ImportSheet,mapping:BankColumnMapping):{found:boolean;account:string} {
 const accounts=new Set<string>();let found=false;
 for(const row of sheet.rows.slice(0,mapping.headerRow))for(let i=0;i<row.length;i++){
  const cell=row[i];if(cell.formula||cell.error)continue;
  const match=String(cell.value??'').trim().match(/^Account\s*(?:Number|No\.?|#)\s*:?\s*([\d -]*)$/i);
  if(!match)continue;found=true;
  const adjacent=row[i+1];
  const value=match[1].trim()||(adjacent&&!adjacent.formula&&!adjacent.error?String(adjacent.value??'').trim():'');
  if(!/^\d[\d -]*$/.test(value)||value.replace(/\D/g,'').length<4)return {found:true,account:''};
  accounts.add(value.replace(/\D/g,'').slice(-4));
 }
 return {found,account:accounts.size===1?[...accounts][0]:''};
}

function bundleAccount(sheet:ImportSheet,mapping:BankColumnMapping,month:Month):string {
 // Placeholder is used only to validate source rows for inference; never returned as evidence.
 const parsed=parseBankSpreadsheet([sheet],'Account identification',{mapping,account:'0000'});
 const amounts=new Set(parsed.deposits.filter(d=>!d.kind).map(d=>d.amountCents));
 let candidates:Set<string>|undefined;let supporting=0;
 for(const amount of amounts){
  const matches=new Set(month.properties.flatMap(p=>p.payments).filter(p=>p.type==='Airbnb'&&p.receivedBy!=='owner'&&p.bundleCents===amount).map(p=>bankAccount(p.bankDetails??'')).filter(Boolean));
  if(!matches.size)continue;
  supporting++;candidates=candidates?new Set([...candidates].filter(account=>matches.has(account))):matches;
 }
 return supporting>=2&&candidates?.size===1?[...candidates][0]:'';
}

export async function prepareBankSheet(sheet:ImportSheet,source:string,month:Month,ask?:BankMappingAssistant,onProgress?:(label:string)=>void):Promise<PreparedBankSheet> {
 if(sheet.error)throw new Error(sheet.error);
 let mapping:BankColumnMapping|undefined,method:'ai'|'automatic'='automatic',note='Columns recognized automatically.';
 let aiError='';
 if(ask){
  try{
   const reply=await ask({task:'bankMapping',bankSample:bankMappingSample(sheet,source),monthId:month.id,message:'Interpret bank transaction columns for the existing import workflow.',history:[]},onProgress);
   mapping=validateBankMapping(sheet,reply.bankMapping);method='ai';note='AI interpreted the columns; the app validates the original transaction values.';
  }catch(error){aiError=error instanceof Error?error.message:'AI interpretation was unavailable.';}
 }
 if(!mapping){
  try{mapping=validateBankMapping(sheet,detectBankColumns(sheet));}
  catch{throw new Error(`${source} / ${sheet.name}: ${aiError||'This layout needs AI interpretation. Connect the configured AI backend and retry.'}`);}
  if(aiError)note=`${aiError} Recognized columns were processed automatically instead.`;
 }
 let account='';
 if(mapping.account===undefined){
  const metadata=sourceAccount(sheet,mapping);
  account=metadata.found?metadata.account:bundleAccount(sheet,mapping,month);
  if(account)note+=metadata.found?` Account ${account} read from the file header.`:` Account ${account} suggested from multiple exact payout bundle matches. Check the account in the review.`;
 }
 return {source,sheet,mapping,account,method,note};
}
