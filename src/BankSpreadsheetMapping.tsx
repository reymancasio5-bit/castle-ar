import type {PreparedBankSheet} from './bank-ai';
import {bankMappingCurrency,bankSheetAccount} from './bank-spreadsheet';

export function bankDraftReady(draft:PreparedBankSheet){
 if(draft.excluded)return true;
 return !draft.issue&&!!draft.currency&&(draft.mapping.account!==undefined||(/^\d[\d -]*$/.test(draft.account.trim())&&/^\d{5,34}$/.test(draft.account.replace(/\D/g,''))));
}
export default function BankSpreadsheetMapping({drafts,onChange,onRetry,disabled}:{drafts:PreparedBankSheet[];onChange:(drafts:PreparedBankSheet[])=>void;onRetry?:()=>void;disabled:boolean}) {
 const update=(index:number,patch:Partial<PreparedBankSheet>)=>onChange(drafts.map((draft,i)=>i===index?{...draft,...patch}:draft));
 return <section className="bank-mapping" aria-labelledby="bank-preparation-title"><h3 id="bank-preparation-title">Bank Files</h3><p>Dates, descriptions, references, and incoming amounts are read automatically. Review the transactions below. Only details missing from the source file need confirmation.</p>
 {drafts.map((draft,index)=>{
  const headings=draft.sheet.rows[draft.mapping.headerRow]??[];
  const sourceCurrency=bankMappingCurrency(draft.sheet,draft.mapping);
  const sourceAccount=bankSheetAccount(draft.sheet,draft.mapping);
  const needsAccount=draft.mapping.account===undefined&&sourceAccount.account.length<=4;
  return <fieldset key={index} disabled={disabled} className="bank-mapping-sheet"><legend>{draft.source} / {draft.sheet.name}</legend>
   {draft.issue?<p role="alert" className="import-inline-error">{draft.issue} This worksheet could not be read automatically. Retry reading, upload an original bank export, or exclude this worksheet.</p>:<><strong>Read Automatically</strong><p className="bank-file-recognition">Incoming amounts: {String(headings[draft.mapping.amount]?.value??'Detected Amount Column')}{sourceCurrency?` · ${sourceCurrency}`:''}. References are extracted from the transaction details. Outgoing payments are excluded.</p></>}
   {!draft.issue&&<div className="bank-mapping-fields">
    {needsAccount&&<label>Full Bank Account Number<input value={draft.account} inputMode="numeric" autoComplete="off" placeholder="Enter the full source account" onChange={e=>update(index,{account:e.target.value})}/><small>The file does not include a complete account number. Confirm it from the bank account.</small></label>}
    {!sourceCurrency&&<label>Currency<select aria-label={`Currency For ${draft.sheet.name}`} value={draft.currency??''} onChange={e=>update(index,{currency:e.target.value==='CAD'||e.target.value==='USD'?e.target.value:undefined})}><option value="">Choose Source Currency</option><option value="CAD">CAD — Canadian Dollar</option><option value="USD">USD — US Dollar</option></select><small>The file does not specify its currency. Confirm it from the bank account.</small></label>}
   </div>}
   <details className="bank-column-details"><summary>View Source Rows</summary>
    <div className="import-table-scroll bank-source-preview" role="region" aria-label={`Source Preview For ${draft.sheet.name}`} tabIndex={0}><table className="import-table"><thead><tr><th>Source Row</th>{headings.map((heading,column)=><th key={column}>{String(heading.value??`Column ${column+1}`)}</th>)}</tr></thead><tbody>{draft.sheet.rows.slice(draft.mapping.headerRow+1,draft.mapping.headerRow+6).map((row,r)=><tr key={r}><th scope="row">{draft.mapping.headerRow+r+2}</th>{headings.map((_,column)=><td key={column}>{row[column]?.formatted??String(row[column]?.value??'')}</td>)}</tr>)}</tbody></table></div>
    <label className="bank-exclude-sheet"><input type="checkbox" checked={!!draft.excluded} onChange={e=>update(index,{excluded:e.target.checked})}/> Exclude This Worksheet</label>
   </details>
   {draft.excluded&&<p>No transactions from this worksheet will be imported.</p>}
  </fieldset>;
 })}
 {drafts.some(d=>d.issue&&!d.excluded)&&onRetry&&<button className="import-button import-button-secondary" disabled={disabled} onClick={onRetry}>Retry Reading</button>}
 </section>;
}
