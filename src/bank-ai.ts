import type {AssistantRequest,AssistantReply,BankMappingSample} from './assistant-types.ts';
import type {ImportSheet} from './import.ts';
import type {BankCurrency,Month} from './types.ts';
import {AmbiguousBankColumnsError,bankMappingCurrency,bankSheetAccount,detectBankColumns,validateBankColumnMapping,type BankColumnMapping} from './bank-spreadsheet.ts';

export type BankMappingAssistant=(request:AssistantRequest,onProgress?:(label:string)=>void)=>Promise<AssistantReply>;
export interface PreparedBankSheet {
 source:string;
 sheet:ImportSheet;
 mapping:BankColumnMapping;
 account:string;
 currency?:BankCurrency;
 method:'ai'|'automatic'|'manual';
 note:string;
 issue?:string;
 excluded?:boolean;
}
export {validateBankColumnMapping as validateBankMapping,validateBankColumnMapping as validateManualBankMapping};

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

export async function prepareBankSheet(sheet:ImportSheet,source:string,month:Month,ask?:BankMappingAssistant,onProgress?:(label:string)=>void):Promise<PreparedBankSheet> {
 if(sheet.error)throw new Error(sheet.error);
 let mapping:BankColumnMapping,method:'ai'|'automatic'='automatic',note='Columns recognized automatically. No AI was used.';
 try{mapping=validateBankColumnMapping(sheet,detectBankColumns(sheet));}
 catch(localError){
  const reason=localError instanceof Error?localError.message:'Unknown layout';
  if(localError instanceof AmbiguousBankColumnsError)throw new Error(`${source} / ${sheet.name}: ${reason}`);
  if(!ask)throw new Error(`${source} / ${sheet.name}: ${reason}`);
  try{
   onProgress?.('Automatic Recognition Failed · Trying AI Assistance');
   const reply=await ask({task:'bankMapping',bankSample:bankMappingSample(sheet,source),monthId:month.id,message:'Interpret bank transaction columns for the existing import workflow.',history:[]},onProgress);
   mapping=validateBankColumnMapping(sheet,reply.bankMapping);method='ai';note='AI mapped the columns. The app validates the original transaction values.';
  }catch(error){throw new Error(`${source} / ${sheet.name}: Automatic recognition failed (${reason}). AI assistance also failed: ${error instanceof Error?error.message:'Unavailable'}`);}
 }
 const metadata=bankSheetAccount(sheet,mapping);
 const account=mapping.account===undefined?metadata.account:'';
 const issue=metadata.found&&!metadata.account?'The worksheet has conflicting or unreadable source account numbers.':undefined;
 if(account.length>=4)note+=` Account ending in ${account.slice(-4)} came from the file header.`;
 return {source,sheet,mapping,account,currency:bankMappingCurrency(sheet,mapping),method,note,issue};
}
