import type {PreparedBankSheet} from './bank-ai';
import {validateManualBankMapping} from './bank-ai';
import {bankMappingCurrency,bankSheetAccount,detectBankColumns,type BankColumnMapping} from './bank-spreadsheet';

const fields:{key:Exclude<keyof BankColumnMapping,'headerRow'>;label:string;required?:boolean}[]=[
 {key:'date',label:'Transaction Date',required:true},{key:'description',label:'Description',required:true},
 {key:'amount',label:'Incoming Amount',required:true},{key:'description2',label:'Additional Description'},
 {key:'account',label:'Account Number'},{key:'reference',label:'Transaction Reference'},
 {key:'debit',label:'Debit Amount'},{key:'status',label:'Posting Status'},
];
export function bankDraftReady(draft:PreparedBankSheet){
 if(draft.excluded)return true;
 return !draft.issue&&!!draft.currency&&(draft.mapping.account!==undefined||(/^\d[\d -]*$/.test(draft.account.trim())&&/^\d{5,34}$/.test(draft.account.replace(/\D/g,''))));
}
export default function BankSpreadsheetMapping({drafts,reviewed,onChange,onReview,onRetry,disabled}:{drafts:PreparedBankSheet[];reviewed:boolean;onChange:(drafts:PreparedBankSheet[])=>void;onReview:()=>void;onRetry?:()=>void;disabled:boolean}) {
 const update=(index:number,patch:Partial<PreparedBankSheet>)=>onChange(drafts.map((draft,i)=>i===index?{...draft,...patch}:draft));
 const remap=(index:number,mapping:BankColumnMapping)=>{
  const draft=drafts[index];let issue:string|undefined;
  try{validateManualBankMapping(draft.sheet,mapping);}catch(error){issue=error instanceof Error?error.message:'Review the selected columns.';}
  const detectedCurrency=bankMappingCurrency(draft.sheet,mapping);
  const metadata=bankSheetAccount(draft.sheet,mapping);
  if(metadata.found&&!metadata.account)issue='The worksheet has conflicting or unreadable source account numbers.';
  update(index,{mapping,method:'manual',note:'Column choices updated. Original transaction values will be validated before review.',issue,currency:detectedCurrency??draft.currency,account:metadata.account||draft.account});
 };
 return <section className="bank-mapping" aria-labelledby="bank-preparation-title"><h3 id="bank-preparation-title">Transaction Preparation</h3><p>Check the detected fields and resolve missing details. Account and currency must come from the bank record. Nothing is saved until you submit the reviewed payment rows.</p>
 {drafts.map((draft,index)=>{
  const headings=draft.sheet.rows[draft.mapping.headerRow]??[];
  const sourceCurrency=bankMappingCurrency(draft.sheet,draft.mapping);
  const sourceAccount=bankSheetAccount(draft.sheet,draft.mapping);
  return <fieldset key={index} disabled={disabled} className="bank-mapping-sheet"><legend>{draft.source} / {draft.sheet.name}</legend>
   {draft.issue?<p role="alert" className="import-inline-error">{draft.issue} Review the columns below, retry interpretation, or explicitly exclude this worksheet.</p>:<><strong>{draft.method==='ai'?'AI-Assisted Interpretation':draft.method==='manual'?'Reviewed Column Mapping':'Automatic Format Recognition'}</strong><p>{draft.note}</p></>}
   <div className="bank-mapping-fields">
    {draft.mapping.account===undefined?<label>Full Bank Account Number<input value={draft.account} readOnly={sourceAccount.account.length>4} inputMode="numeric" autoComplete="off" placeholder="Enter the full source account" onChange={e=>update(index,{account:e.target.value})}/><small>{sourceAccount.account.length>4?'Read from the statement header.':'Include more than the last four digits to keep different accounts separate.'}</small></label>:<div className="bank-mapping-evidence"><strong>Account Number</strong><span>Read from {String(headings[draft.mapping.account]?.value??'the source column')}.</span></div>}
    <label>Currency{sourceCurrency?<><span className="bank-mapping-value">{sourceCurrency}</span><small>Read from the source workbook.</small></>:<select aria-label={`Currency For ${draft.sheet.name}`} value={draft.currency??''} onChange={e=>update(index,{currency:e.target.value==='CAD'||e.target.value==='USD'?e.target.value:undefined})}><option value="">Choose Source Currency</option><option value="CAD">CAD — Canadian Dollar</option><option value="USD">USD — US Dollar</option></select>}</label>
   </div>
   <details className="bank-column-details" open={!!draft.issue}><summary>Review Or Adjust Columns</summary>
    <p>Select the original transaction headings. Balances, totals, formulas, conflicting currencies, and ambiguous debit/status columns cannot be used as deposit evidence.</p>
    <div className="bank-mapping-fields"><label>Header Row<input type="number" min="1" max={Math.max(1,draft.sheet.rows.length-1)} value={draft.mapping.headerRow+1} onChange={e=>{const row=Number(e.target.value)-1;if(Number.isInteger(row)&&row>=0&&row<draft.sheet.rows.length-1)remap(index,detectBankColumns(draft.sheet,row));}}/></label>
    {fields.map(field=><label key={field.key}>{field.label}{field.required?' *':''}<select aria-label={`${field.label} Column For ${draft.sheet.name}`} value={draft.mapping[field.key]??-1} onChange={e=>{const mapping={...draft.mapping};const value=Number(e.target.value);if(value<0&&!field.required)delete mapping[field.key];else mapping[field.key]=value;remap(index,mapping);}}><option value={-1}>{field.required?'Select A Column':'Not Present'}</option>{headings.map((heading,column)=><option key={column} value={column}>{column+1}: {String(heading.value??'(Blank)').slice(0,100)}</option>)}</select></label>)}
    </div>
    <div className="import-table-scroll bank-source-preview" role="region" aria-label={`Source Preview For ${draft.sheet.name}`} tabIndex={0}><table className="import-table"><thead><tr><th>Source Row</th>{headings.map((heading,column)=><th key={column}>{String(heading.value??`Column ${column+1}`)}</th>)}</tr></thead><tbody>{draft.sheet.rows.slice(draft.mapping.headerRow+1,draft.mapping.headerRow+6).map((row,r)=><tr key={r}><th scope="row">{draft.mapping.headerRow+r+2}</th>{headings.map((_,column)=><td key={column}>{row[column]?.formatted??String(row[column]?.value??'')}</td>)}</tr>)}</tbody></table></div>
   </details>
   <label className="bank-exclude-sheet"><input type="checkbox" checked={!!draft.excluded} onChange={e=>update(index,{excluded:e.target.checked})}/> Exclude This Worksheet</label>{draft.excluded&&<p>No transactions from this worksheet will be imported.</p>}
  </fieldset>;
 })}
 {drafts.some(d=>d.issue&&!d.excluded)&&onRetry&&<button className="import-button import-button-secondary" disabled={disabled} onClick={onRetry}>Retry Interpretation</button>}
 {!reviewed&&<button className="import-button import-button-primary" disabled={disabled||!drafts.every(bankDraftReady)} onClick={onReview}>Continue To Review</button>}
 </section>;
}
