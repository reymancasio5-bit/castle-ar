import type {PreparedBankSheet} from './bank-ai';

export default function BankSpreadsheetMapping({drafts,reviewed,onChange,onReview,onRetry,disabled}:{drafts:PreparedBankSheet[];reviewed:boolean;onChange:(drafts:PreparedBankSheet[])=>void;onReview:()=>void;onRetry?:()=>void;disabled:boolean}) {
 const update=(index:number,account:string)=>onChange(drafts.map((draft,i)=>i===index?{...draft,account}:draft));
 return <section className="bank-mapping"><h3>Automatic Transaction Preparation</h3><p>The app interprets columns and applies its transaction validation and matching rules. Resolve any exceptions below. Nothing is saved until you submit the reviewed payment rows.</p>
 {drafts.map((draft,index)=><fieldset key={index} disabled={disabled} className="bank-mapping-sheet"><legend>{draft.source} / {draft.sheet.name}</legend>
  {draft.issue?<><p role="alert">{draft.issue}</p><label><input type="checkbox" checked={!!draft.excluded} onChange={e=>onChange(drafts.map((d,i)=>i===index?{...d,excluded:e.target.checked}:d))}/> Exclude This Worksheet</label><p>Exclude only a worksheet you do not want imported, such as notes or a summary. Its transactions will not be saved.</p></>:<><strong>{draft.method==='ai'?'AI-Assisted Interpretation':'Automatic Format Recognition'}</strong><p>{draft.note}</p></>}
  {!draft.issue&&draft.mapping.account===undefined&&<details open={!reviewed}><summary>{draft.account?`Account ${draft.account} · Review Or Correct`:'Account Needed'}</summary>
   <p>{draft.account?'This account will be used for this worksheet.':'The file does not identify its account, and the app could not establish one uniquely. Enter only the missing account to continue.'}</p>
   <div className="bank-mapping-fields"><label>Bank Account / Last Four Digits<input value={draft.account} inputMode="numeric" placeholder="Enter the source account" onChange={e=>update(index,e.target.value)}/></label></div>
  </details>}
 </fieldset>)}
 {drafts.some(d=>d.issue&&!d.excluded)&&onRetry&&<button className="import-button import-button-secondary" disabled={disabled} onClick={onRetry}>Retry Interpretation</button>}
 {!reviewed&&<button className="import-button import-button-primary" disabled={disabled||drafts.some(d=>!d.excluded&&(d.issue||d.mapping.account===undefined&&(!/^\d[\d -]*$/.test(d.account.trim())||d.account.replace(/\D/g,'').length<4)))} onClick={onReview}>Continue To Review</button>}
 </section>;
}
