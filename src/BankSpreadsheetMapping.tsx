import {detectBankColumns, type BankColumnMapping} from './bank-spreadsheet';
import type {ImportSheet} from './import';

export interface BankSheetDraft {source:string; sheet:ImportSheet; mapping:BankColumnMapping; account:string; skip:boolean}
const fields: [Exclude<keyof BankColumnMapping,'headerRow'>,string,boolean][] = [
 ['date','Transaction Date',true],['description','Description',true],['description2','Additional Description',false],
 ['amount','Amount / Credit',true],['debit','Debit',false],['account','Account Number',false],
 ['reference','Transaction Reference',false],['status','Transaction Status',false],
];
export default function BankSpreadsheetMapping({drafts,onChange,onReview,disabled}:{drafts:BankSheetDraft[];onChange:(drafts:BankSheetDraft[])=>void;onReview:()=>void;disabled:boolean}) {
 const update=(index:number,patch:Partial<BankSheetDraft>)=>onChange(drafts.map((draft,i)=>i===index?{...draft,...patch}:draft));
 return <section className="bank-mapping"><h3>Map Transaction Columns</h3><p>Confirm the columns for each worksheet. Amounts stay in the source currency; no conversion is applied. Use a signed amount (positive for deposits) or a credit column with its debit column. Dates can be Excel dates, YYYY-MM-DD, or MM/DD/YYYY. Skip worksheets that contain no transactions.</p>
 {drafts.map((draft,index)=><fieldset key={index} disabled={disabled} className="bank-mapping-sheet"><legend>{draft.source} / {draft.sheet.name}</legend>
  <label><input type="checkbox" checked={draft.skip} onChange={e=>update(index,{skip:e.target.checked})}/> Skip This Worksheet</label>
  {!draft.skip&&<><div className="bank-mapping-fields"><label>Header Row<input type="number" min={1} max={draft.sheet.rows.length} value={draft.mapping.headerRow+1} onChange={e=>{const row=Number(e.target.value)-1;if(Number.isInteger(row)&&row>=0&&row<draft.sheet.rows.length)update(index,{mapping:detectBankColumns(draft.sheet,row)});}}/></label>
   {fields.map(([key,label,required])=><label key={key}>{label}{required?' *':''}<select value={draft.mapping[key]??-1} onChange={e=>update(index,{mapping:{...draft.mapping,[key]:Number(e.target.value)<0?(required?-1:undefined):Number(e.target.value)}})}>
    <option value={-1}>{required?'Choose A Column':'Not In File'}</option>
    {draft.sheet.rows[draft.mapping.headerRow]?.map((cell,i)=><option key={i} value={i}>{i+1}: {String(cell.value??'Empty Heading')}</option>)}
   </select></label>)}
   {draft.mapping.account===undefined&&<label>Bank Account / Last Four Digits *<input value={draft.account} inputMode="numeric" placeholder="Enter the source account" onChange={e=>update(index,{account:e.target.value})}/></label>}
  </div><p>First transaction row:</p><div className="import-table-scroll"><table className="import-table"><thead><tr>{draft.sheet.rows[draft.mapping.headerRow]?.map((cell,i)=><th key={i}>{String(cell.value??'')}</th>)}</tr></thead><tbody><tr>{draft.sheet.rows[draft.mapping.headerRow+1]?.map((cell,i)=><td key={i}>{cell.formatted??String(cell.value??'')}</td>)}</tr></tbody></table></div></>}
 </fieldset>)}
 <button className="import-button import-button-primary" disabled={disabled} onClick={onReview}>Review Mapped Transactions</button>
 </section>;
}
