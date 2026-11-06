import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Upload, X, CheckCircle2 } from 'lucide-react';
import type { Change, Month, Snapshot } from './types';
import { matchStatement, parseStatement, type BankDeposit } from './bank-statement';
import { money } from './domain';
import {matchOwnerDeposits, applyOwnerChange} from './owners';
import OwnerPaymentReview, {allocationDraft, parseAllocations} from './OwnerPaymentReview';
import './import.css';
import './bank-statement.css';
export default function BankStatementImport({month,onClose,onApply,supported,initialFile,snapshot}:{snapshot?:Snapshot;initialFile?:File;month:Month;onClose:()=>void;onApply:(changes:Change[])=>Promise<void>;supported:boolean}){
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
 const [deposits,setDeposits]=useState<BankDeposit[]>([]),[warnings,setWarnings]=useState<string[]>([]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[reviewed,setReviewed]=useState(false);
 const [allocations,setAllocations]=useState<Record<number,Record<string,string>>>({}),[skipped,setSkipped]=useState<Record<number,boolean>>({});
 const ownerRows=useMemo(()=>matchOwnerDeposits(deposits,month,snapshot?.owners??[],snapshot?.ownerTransfers??[]),[deposits,month,snapshot]);
 const result=useMemo(()=>matchStatement(deposits,month),[deposits,month]);
 const ownerReview=useMemo(()=>{
  const changes:Change[]=[],errors:Record<number,string>={};
  const working=snapshot?structuredClone(snapshot):null;
  ownerRows.forEach((row,index)=>{
   if(row.duplicate||skipped[index])return;
   try{
    if(!working||working.ownerSchema!==1)throw new Error('Update the Apps Script deployment to record owner payments, or skip this deposit.');
    if(!row.owner)throw new Error('Add or correct this owner’s bank name in Property Owners, then import again.');
    if(!row.deposit.reference)throw new Error('A readable transaction reference is required to prevent duplicate payments.');
    if(!row.properties.length)throw new Error('Map this owner to an AR property in the selected reporting month, then import again.');
    const split=parseAllocations(allocations[index]??allocationDraft(row));
    if(!split.length)throw new Error('Choose the property amounts for this deposit, or skip it for now.');
    if(split.reduce((sum,a)=>sum+a.amountCents,0)!==row.deposit.amountCents)throw new Error('Allocated amounts must equal the full deposit.');
    const change:Change={kind:'importOwnerTransfer',ownerId:row.owner.id,monthId:month.id,account:row.deposit.account,date:row.deposit.date,reference:row.deposit.reference,source:row.deposit.source,bankName:row.deposit.ownerName??'',amountCents:row.deposit.amountCents,allocations:split};
    applyOwnerChange(working,change);changes.push(change);
   }catch(error){errors[index]=error instanceof Error?error.message:'Review this payment.';}
  });
  return {changes,errors};
 },[ownerRows,allocations,skipped,snapshot,month.id]);
 const changes=[...result.changes,...ownerReview.changes],hasUnresolved=Object.keys(ownerReview.errors).length>0;
 const rowCount=result.changes.length+ownerReview.changes.reduce((sum,c)=>sum+(c.kind==='importOwnerTransfer'?c.allocations.length:0),0);
 useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
 async function files(files:FileList|File[]|null){
  if(!files?.length||busy||saving)return;
  setBusy(true);setError('');setReviewed(false);setDeposits([]);setWarnings([]);setAllocations({});setSkipped({});
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
 useEffect(()=>{if(initialFile)void files([initialFile]);},[initialFile]);
 async function save(){setSaving(true);setError('');try{if(hasUnresolved)throw new Error('Allocate or skip each owner deposit before saving.');await onApply(changes);}catch(e){setError((e as Error).message);}finally{setSaving(false);}}
 return <dialog ref={dialog} className="import-modal bank-statement-modal" aria-labelledby="bank-import-title" onCancel={e=>{e.preventDefault();if(!busy&&!saving)onClose();}}>
  <header className="import-header"><div className="import-header-icon"><FileText size={23}/></div><div><p className="import-eyebrow">BANK RECONCILIATION</p><h2 id="bank-import-title">Import Bank Statement</h2><p>Match Airbnb and owner deposits to {month.label} records.</p></div><button className="import-icon-button" onClick={onClose} disabled={busy||saving} aria-label="Close bank statement import"><X size={21}/></button></header>
  <div className="import-content" aria-busy={busy||saving}>
   {error&&<div className="import-alert" role="alert">{error}</div>}
   {!supported&&<div className="import-warning">Update the Google Apps Script deployment with the supplied Code.gs to enable bank statement verification.</div>}
   <div className="import-dropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void files(e.dataTransfer.files);}}><div className="import-upload-icon"><Upload size={28}/></div><h3>Bring Your Bank Deposits In</h3><p>Choose RBC chequing statements. Match AIRBNB PAYMENTS bundles and owner e-Transfer - Autodeposit credits.</p><input ref={input} className="import-hidden-input" type="file" accept=".pdf,application/pdf" multiple onChange={e=>void files(e.target.files)}/><button className="import-button import-button-primary" disabled={busy||saving} onClick={()=>input.current?.click()}>{busy?'Reading statements…':'Choose Bank PDFs'}</button><small>Up to 10 PDFs · 20 MB per file · Read locally in your browser</small></div>
   <div className="import-guidance"><CheckCircle2 size={19}/><div><strong>Review Bank Deposits Before Saving</strong><p>Airbnb deposits match payout bundles and bank accounts. Owner deposits are applied directly to their properties, with exact amounts and the bank transaction date.</p></div></div>
   {warnings.length>0&&<div className="import-warning">{warnings.length} entries could not be read completely and were skipped. Check the original bank statement.</div>}
   {reviewed&&<><div className="import-section-heading"><h3>Review Matches</h3><span>{deposits.length} deposits · {rowCount} rows to update</span></div>{!deposits.length?<p>No readable Airbnb or owner deposits found. Check the bank statement PDF.</p>:result.rows.length>0?<div className="import-table-scroll import-review-scroll"><table className="import-table"><thead><tr><th>Statement / Bank</th><th>Bank Date</th><th>Statement Bundle / F Match</th><th>Matched Rows / D To I</th><th>Result</th></tr></thead><tbody>{result.rows.map((row,i)=><tr key={i}><td>{row.deposit.source}<small>Checking {row.deposit.account} {row.deposit.reference&&`· ${row.deposit.reference}`}</small></td><td>{row.deposit.date}</td><td>{money(row.deposit.amountCents)}</td><td>{row.payments.map(({property,payment})=><div key={payment.id}>{property}<small>Row {payment.id.split(':').at(-1)} · {money(payment.amountCents)}</small></div>)}</td><td><span className={`import-status import-status-${row.status==='Ready'?'ready':'skipped'}`}>{row.status}</span></td></tr>)}</tbody></table></div>:null}</>}
   {reviewed&&ownerRows.length>0&&<><div className="import-section-heading"><h3>Owner Payments</h3><span>{ownerRows.length} deposits · {ownerReview.changes.length} ready</span></div><p className="owner-help">A unique exact balance match is preselected. Review other deposits and split them as needed. These direct payments have no bundle amount; each allocation reduces the property’s outstanding balance when saved.</p>{ownerRows.map((row,index)=><OwnerPaymentReview key={index} row={row} values={allocations[index]??allocationDraft(row)} skipped={!!skipped[index]} disabled={busy||saving} error={ownerReview.errors[index]} onChange={values=>setAllocations(previous=>({...previous,[index]:values}))} onSkip={skip=>setSkipped(previous=>({...previous,[index]:skip}))}/>)}</>}
   {rowCount>500&&<div className="import-warning">More than 500 rows match. Import fewer statement files at a time.</div>}
  </div>
  <footer className="import-footer"><button className="import-button import-button-secondary" disabled={busy||saving} onClick={onClose}>Cancel</button><button className="import-button import-button-primary" disabled={!supported||!reviewed||!changes.length||rowCount>500||hasUnresolved||busy||saving} onClick={()=>void save()}>{saving?'Saving…':`Save ${rowCount} Payment Rows`}</button></footer>
 </dialog>;
}
