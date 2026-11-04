import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Upload, X, CheckCircle2 } from 'lucide-react';
import type { Change, Month } from './types';
import { matchStatement, parseStatement, type BankDeposit } from './bank-statement';
import { money } from './domain';
import './import.css';
import './bank-statement.css';
export default function BankStatementImport({month,onClose,onApply,supported}:{month:Month;onClose:()=>void;onApply:(changes:Change[])=>Promise<void>;supported:boolean}){
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
 const [deposits,setDeposits]=useState<BankDeposit[]>([]),[warnings,setWarnings]=useState<string[]>([]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[reviewed,setReviewed]=useState(false);
 const result=useMemo(()=>matchStatement(deposits,month),[deposits,month]);
 useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
 async function files(files:FileList|null){
  if(!files?.length||busy||saving)return;
  setBusy(true);setError('');setReviewed(false);setDeposits([]);setWarnings([]);
  try{
   if(files.length>10||Array.from(files).reduce((n,f)=>n+f.size,0)>50*1024*1024)throw new Error('Choose up to 10 PDFs, totaling no more than 50 MB.');
   const {extractStatementText}=await import('./bank-pdf');
   const all:BankDeposit[]=[],notes:string[]=[];
   for(const file of Array.from(files)){
    if(!/\.pdf$/i.test(file.name))throw new Error('Choose PDF bank statements.');
    const extracted=await extractStatementText(file);const parsed=parseStatement(extracted,file.name);
    all.push(...parsed.deposits);notes.push(...parsed.warnings);
   }
   setDeposits(all);setWarnings(notes);setReviewed(true);
  }catch(e){setError(e instanceof Error?e.message:'Could not read the statement.');}finally{setBusy(false);if(input.current)input.current.value='';}
 }
 async function save(){setSaving(true);setError('');try{await onApply(result.changes);}catch(e){setError((e as Error).message);}finally{setSaving(false);}}
 return <dialog ref={dialog} className="import-modal bank-statement-modal" aria-labelledby="bank-import-title" onCancel={e=>{e.preventDefault();if(!busy&&!saving)onClose();}}>
  <header className="import-header"><div className="import-header-icon"><FileText size={23}/></div><div><p className="import-eyebrow">BANK RECONCILIATION</p><h2 id="bank-import-title">Import bank statement</h2><p>Match Airbnb deposits to {month.label} records.</p></div><button className="import-icon-button" onClick={onClose} disabled={busy||saving} aria-label="Close bank statement import"><X size={21}/></button></header>
  <div className="import-content" aria-busy={busy||saving}>
   {error&&<div className="import-alert" role="alert">{error}</div>}
   {!supported&&<div className="import-warning">Update the Google Apps Script deployment with the supplied Code.gs to enable bank statement verification.</div>}
   <div className="import-dropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void files(e.dataTransfer.files);}}><div className="import-upload-icon"><Upload size={28}/></div><h3>Bring your bank deposits in</h3><p>Choose RBC chequing statements. Only AIRBNB PAYMENTS deposits are matched.</p><input ref={input} className="import-hidden-input" type="file" accept=".pdf,application/pdf" multiple onChange={e=>void files(e.target.files)}/><button className="import-button import-button-primary" disabled={busy||saving} onClick={()=>input.current?.click()}>{busy?'Reading statements…':'Choose Bank PDFs'}</button><small>Up to 10 PDFs · 20 MB per file · Read locally in your browser</small></div>
   <div className="import-guidance"><CheckCircle2 size={19}/><div><strong>Each row keeps its own amount</strong><p>Match the deposit to column F and the bank account. Copy each matched row’s column D to I, fill H with the bank transaction date, and mark J as verified. Daisy verification stays unchanged.</p></div></div>
   {warnings.length>0&&<div className="import-warning">{warnings.length} entries could not be read completely and were skipped. Check the original bank statement.</div>}
   {reviewed&&<><div className="import-section-heading"><h3>Review matches</h3><span>{deposits.length} deposits · {result.changes.length} rows to update</span></div>{!deposits.length?<p>No readable AIRBNB PAYMENTS deposits found. Check the bank statement PDF.</p>:<div className="import-table-scroll import-review-scroll"><table className="import-table"><thead><tr><th>Statement / bank</th><th>Bank date</th><th>Bundle deposit</th><th>Matched rows / bank amounts</th><th>Result</th></tr></thead><tbody>{result.rows.map((row,i)=><tr key={i}><td>{row.deposit.source}<small>Checking {row.deposit.account} {row.deposit.reference&&`· ${row.deposit.reference}`}</small></td><td>{row.deposit.date}</td><td>{money(row.deposit.amountCents)}</td><td>{row.payments.map(({property,payment})=><div key={payment.id}>{property}<small>Row {payment.id.split(':').at(-1)} · {money(payment.amountCents)}</small></div>)}</td><td><span className={`import-status import-status-${row.status==='Ready'?'ready':'skipped'}`}>{row.status}</span></td></tr>)}</tbody></table></div>}</>}
   {result.changes.length>500&&<div className="import-warning">More than 500 rows match. Import fewer statement files at a time.</div>}
  </div>
  <footer className="import-footer"><button className="import-button import-button-secondary" disabled={busy||saving} onClick={onClose}>Cancel</button><button className="import-button import-button-primary" disabled={!supported||!reviewed||!result.changes.length||result.changes.length>500||busy||saving} onClick={()=>void save()}>{saving?'Saving…':`Verify ${result.changes.length} Matched Rows`}</button></footer>
 </dialog>;
}

