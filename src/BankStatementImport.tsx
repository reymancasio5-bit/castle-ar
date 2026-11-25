import {useEffect,useMemo,useRef,useState} from 'react';
import {FileText,Upload,CheckCircle2} from 'lucide-react';
import type {Change,Month,Snapshot} from './types';
import {matchStatement,parseStatement,type BankDeposit,type BankImportExclusion,type BankImportResult} from './bank-statement';
import {balance} from './domain';
import {matchOwnerDeposits,applyOwnerChange,ownerDepositSkipped,ownerBankNames} from './owners';
import OwnerPaymentReview,{allocationDraft,parseAllocations} from './OwnerPaymentReview';
import {BankImportReviewRequired,prepareFreshBankImport,remapBankAllocationDrafts} from './import-save.ts';
import {runProgress,type ReportProgress} from './operation-progress';
import {useBackgroundForm} from './BackgroundWork';
import FormWindowControls from './FormWindowControls';
import BankSpreadsheetMapping,{bankDraftReady} from './BankSpreadsheetMapping';
import {prepareBankSheet,type PreparedBankSheet,type BankMappingAssistant} from './bank-ai';
import {detectBankColumns,parseBankSpreadsheet,bankMappingCurrency} from './bank-spreadsheet';
import {BankSourceSummary,BankExcludedCredits,BankPlatformMatches,BankReviewPager,BANK_REVIEW_PAGE_SIZE} from './BankImportReview';
import './import.css';
import './bank-statement.css';

type SourceDetails={currency?:'CAD'|'USD';account?:string};
type FileFailure={source:string;message:string;excluded:boolean};
const emptyResult=():BankImportResult=>({deposits:[],warnings:[],excluded:[]});
export default function BankStatementImport({month:initialMonth,onClose,onApply,supported,initialFile,snapshot:initialSnapshot,ask}:{ask?:BankMappingAssistant;snapshot?:Snapshot;initialFile?:File;month:Month;onClose:()=>void;onApply:(changes:Change[],prepare?:(latest:Snapshot)=>Change[])=>Promise<void>;supported:boolean}){
 const [snapshot,setReviewSnapshot]=useState(initialSnapshot);
 const month=snapshot?.months.find(m=>m.id===initialMonth.id)??initialMonth;
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
 const [deposits,setDeposits]=useState<BankDeposit[]>([]),[warnings,setWarnings]=useState<string[]>([]),[excluded,setExcluded]=useState<BankImportExclusion[]>([]);
 const [sheetDrafts,setSheetDrafts]=useState<PreparedBankSheet[]>([]),[pdfResult,setPdfResult]=useState<BankImportResult>(emptyResult);
 const [sourceDetails,setSourceDetails]=useState<Record<string,SourceDetails>>({}),[fileFailures,setFileFailures]=useState<FileFailure[]>([]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[reviewed,setReviewed]=useState(false);
 const [selections,setSelections]=useState<Record<string,string>>({}),[ownerPage,setOwnerPage]=useState(0);
 const background=useBackgroundForm('Import Bank Statement',busy||saving,saving);
 const protectedBackend=supported&&snapshot?.bankReceiptSchema===1&&Array.isArray(snapshot.bankReceipts);
 useEffect(()=>{const el=dialog.current;if(background.minimized)el?.close();else if(el&&!el.open)el.showModal();},[background.minimized]);
 const [allocations,setAllocations]=useState<Record<number,Record<string,string>>>({}),[skipped,setSkipped]=useState<Record<number,boolean>>({});
 const [depositEdits,setDepositEdits]=useState<Record<number,{ownerName:string;reference:string}>>({});
 const pdfSources=useMemo(()=>[...new Set([...pdfResult.deposits,...(pdfResult.excluded??[])].map(row=>row.source))].map(source=>{
  const rows=[...pdfResult.deposits,...(pdfResult.excluded??[])].filter(row=>row.source===source);
  return {source,needsCurrency:rows.some(row=>!row.currency),needsAccount:rows.some(row=>!row.accountIdentity||row.accountIdentity.length<=4)};
 }),[pdfResult]);
 const withSourceDetails=<T extends BankDeposit|BankImportExclusion>(row:T):T=>{
  const detail=sourceDetails[row.source];if(!detail)return row;
  const accountIdentity=detail.account?.replace(/\D/g,'');
  return {...row,...(!row.currency&&detail.currency?{currency:detail.currency}:{}),...((!row.accountIdentity||row.accountIdentity.length<=4)&&accountIdentity&&/^\d{5,34}$/.test(accountIdentity)&&(!row.account||accountIdentity.endsWith(row.account))?{accountIdentity,account:accountIdentity.slice(-4)}:{})};
 };
 const reviewDeposits=useMemo(()=>{let index=0;return deposits.map(item=>{const deposit=withSourceDetails(item);if(deposit.kind!=='owner')return deposit;const edit=depositEdits[index++];return {...deposit,...edit,reference:deposit.reference||edit?.reference||''};});},[deposits,depositEdits,sourceDetails]);
 const reviewExcluded=useMemo(()=>excluded.map(withSourceDetails),[excluded,sourceDetails]);
 const originalOwnerDeposits=useMemo(()=>deposits.filter(deposit=>deposit.kind==='owner'),[deposits]);
 const ownerRows=useMemo(()=>matchOwnerDeposits(reviewDeposits,month,snapshot?.owners??[],snapshot?.ownerTransfers??[],snapshot?.ownerAllocationSchema===1?snapshot.months:[month],snapshot?.bankReceipts??[]),[reviewDeposits,month,snapshot]);
 const result=useMemo(()=>matchStatement(reviewDeposits,month,{receipts:snapshot?.bankReceipts??[],months:snapshot?.months??[month],ownerTransfers:snapshot?.ownerTransfers??[],selections}),[reviewDeposits,month,snapshot,selections]);
 const ownerReview=useMemo(()=>{
  const changes:Change[]=[],errors:Record<number,string>={};
  // Only these arrays are mutated by an allocation preview; avoid copying unrelated workspace data.
  const working=snapshot?{...snapshot,months:snapshot.months.map(m=>({...m,properties:m.properties.map(p=>({...p,payments:[...p.payments]}))})),ownerTransfers:[...(snapshot.ownerTransfers??[])]}:null;
  ownerRows.forEach((row,index)=>{
   if(ownerDepositSkipped(row,skipped[index]))return;
   try{
    if(!working||working.ownerSchema!==1)throw new Error('Update the Apps Script deployment to record owner payments, or skip this deposit.');
    if(!row.deposit.accountIdentity||row.deposit.accountIdentity.length<=4||!row.deposit.currency)throw new Error('Confirm the full source account and currency before allocating this deposit.');
    if(!row.owner)throw new Error('Choose a configured statement name, or add the owner and property mapping in Property Owners.');
    if(!row.deposit.reference)throw new Error('Enter the authentic transaction reference from the bank details. If it is absent, obtain a detailed export or skip this deposit.');
    if(!row.properties.length)throw new Error('Map this owner to an AR property, then import again.');
    const split=parseAllocations(allocations[index]??allocationDraft(row)).map(a=>{const target=row.properties.find(p=>p.id===a.propertyId);if(!target)throw new Error('Choose a mapped property and month.');return {...a,...(working.ownerAllocationSchema===1?{monthId:target.monthId}:{})};});
    if(!split.length)throw new Error('Choose the property amounts for this deposit, or skip it for now.');
    if(split.reduce((sum,a)=>sum+a.amountCents,0)!==row.deposit.amountCents)throw new Error('Allocated amounts must equal the full deposit.');
    const change:Change={kind:'importOwnerTransfer',ownerId:row.owner.id,monthId:month.id,account:row.deposit.account,accountIdentity:row.deposit.accountIdentity,currency:row.deposit.currency,date:row.deposit.date,reference:row.deposit.reference,source:row.deposit.source,description:row.deposit.sourceDescription??row.deposit.description,sheet:row.deposit.sheet,sourceRow:row.deposit.sourceRow,bankName:row.deposit.ownerName??'',amountCents:row.deposit.amountCents,allocations:split};
    applyOwnerChange(working,change);changes.push(change);
   }catch(error){errors[index]=error instanceof Error?error.message:'Review this payment.';}
  });
  return {changes,errors,balancePreview:working&&Object.keys(errors).length===0?Object.fromEntries(working.months.flatMap(m=>m.properties.map(p=>[p.id,balance(p)]))):null};
 },[ownerRows,allocations,skipped,snapshot,month.id]);
 const changes=[...result.changes,...ownerReview.changes];
 const missingPdfDetails=pdfSources.some(row=>row.needsCurrency&&!sourceDetails[row.source]?.currency||row.needsAccount&&[...pdfResult.deposits,...(pdfResult.excluded??[])].filter(item=>item.source===row.source).some(item=>{const account=sourceDetails[row.source]?.account??'',identity=account.replace(/\D/g,'');return !/^\d[\d -]*$/.test(account)||!/^\d{5,34}$/.test(identity)||!!item.account&&!identity.endsWith(item.account);}));
 const hasUnresolved=Object.keys(ownerReview.errors).length>0||fileFailures.some(file=>!file.excluded)||missingPdfDetails;
 const rowCount=result.changes.length+ownerReview.changes.reduce((sum,c)=>sum+(c.kind==='importOwnerTransfer'?c.allocations.length:0),0);
 const needsDetails=ownerRows.filter(row=>!row.duplicate&&!row.allocations.length).length+result.rows.filter(row=>row.status!=='Ready'&&!/already|duplicate/i.test(row.status)).length;
 const currentOwnerPage=Math.min(ownerPage,Math.max(0,Math.ceil(ownerRows.length/BANK_REVIEW_PAGE_SIZE)-1));
 const statementNames=useMemo(()=>(snapshot?.owners??[]).flatMap(owner=>ownerBankNames(owner.bankName)),[snapshot?.owners]);
 useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
 function resetChoices(){setAllocations({});setSkipped({});setDepositEdits({});setSelections({});setOwnerPage(0);}
 async function files(files:FileList|File[]|null){
  if(!files?.length||busy||saving)return;
  await runProgress(`Reading ${files.length} Bank File${files.length===1?'':'s'}`,report=>readFiles(files,report)).catch(()=>{});
 }
 async function readFiles(files:FileList|File[],report:ReportProgress){
  setBusy(true);setError('');setReviewed(false);setDeposits([]);setWarnings([]);setExcluded([]);resetChoices();
  setSheetDrafts([]);setPdfResult(emptyResult());setSourceDetails({});setFileFailures([]);
  try{
   if(files.length>25||Array.from(files).reduce((n,f)=>n+f.size,0)>50*1024*1024)throw new Error('Choose up to 25 bank files, totaling no more than 50 MB.');
   const pdf:BankImportResult=emptyResult(),drafts:PreparedBankSheet[]=[],failures:FileFailure[]=[];
   const list=Array.from(files),nameCounts=new Map<string,number>();for(const file of list)nameCounts.set(file.name,(nameCounts.get(file.name)??0)+1);
   for(const [index,file] of list.entries()){
    const source=nameCounts.get(file.name)!>1?`${file.name} [File ${index+1}]`:file.name;
    const fileProgress:ReportProgress=progress=>report({...progress,label:`File ${index+1} Of ${files.length}: ${source} · ${progress.label}`});
    try{
     if(/\.pdf$/i.test(file.name)){
      const {extractStatementText}=await import('./bank-pdf');
      const parsed=parseStatement(await extractStatementText(file,fileProgress),source);
      pdf.deposits.push(...parsed.deposits);pdf.warnings.push(...parsed.warnings);pdf.excluded!.push(...(parsed.excluded??[]));
     }else if(/\.(xlsx|xls|csv)$/i.test(file.name)){
      const {readSpreadsheet}=await import('./excel');
      for(const sheet of await readSpreadsheet(file,fileProgress)){
       if(!sheet.error&&!sheet.rows.some(row=>row.some(cell=>cell.value!=null&&String(cell.value).trim()||cell.formula||cell.error)))continue;
       try{drafts.push(await prepareBankSheet(sheet,source,month,ask,label=>fileProgress({label})));}
       catch(error){const mapping=detectBankColumns(sheet);drafts.push({source,sheet,mapping,account:'',currency:bankMappingCurrency(sheet,mapping),method:'automatic',note:'',issue:error instanceof Error?error.message:'This worksheet could not be interpreted.'});}
      }
     }else throw new Error('Choose a PDF bank statement or an Excel/CSV transaction export.');
    }catch(error){failures.push({source,message:error instanceof Error?error.message:'Could not read this bank file.',excluded:false});}
   }
   setPdfResult(pdf);setSheetDrafts(drafts);setFileFailures(failures);
   if(drafts.every(bankDraftReady)){
    const prepared=parseDrafts(drafts,pdf);setDeposits(prepared.deposits);setWarnings(prepared.warnings);setExcluded(prepared.excluded??[]);setReviewed(true);
   }
  }catch(e){setError(e instanceof Error?e.message:'Could not read the statement.');throw e;}finally{setBusy(false);if(input.current)input.current.value='';}
 }
 useEffect(()=>{if(initialFile)void files([initialFile]);},[initialFile]);
 function parseDrafts(drafts:PreparedBankSheet[],base:BankImportResult):BankImportResult{
  const all=[...base.deposits],notes=[...base.warnings],excluded=[...(base.excluded??[])];
  for(const draft of drafts){
   if(draft.excluded){notes.push(`${draft.source} / ${draft.sheet.name}: Excluded by your selection; no transactions from this worksheet will be imported.`);continue;}
   if(!bankDraftReady(draft))throw new Error(draft.issue||'Confirm the source account and currency for each worksheet.');
   const parsed=parseBankSpreadsheet([draft.sheet],draft.source,{mapping:draft.mapping,account:draft.account,currency:draft.currency});
   all.push(...parsed.deposits);notes.push(...parsed.warnings);excluded.push(...(parsed.excluded??[]));
  }
  return {deposits:all,warnings:notes,excluded};
 }
 async function retryPreparation(){
  if(busy||saving)return;setBusy(true);setError('');
  try{
   const next:PreparedBankSheet[]=[];
   for(const draft of sheetDrafts){
    if(!draft.issue||draft.excluded){next.push(draft);continue;}
    try{const prepared=await prepareBankSheet(draft.sheet,draft.source,month,ask);next.push({...prepared,account:prepared.account||draft.account,currency:prepared.currency??draft.currency});}
    catch(e){next.push({...draft,issue:e instanceof Error?e.message:'Interpretation failed.'});}
   }
   updatePreparedSheets(next);
  }finally{setBusy(false);}
 }
 function updatePreparedSheets(drafts:PreparedBankSheet[]){
  setSheetDrafts(drafts);
  setError('');setReviewed(false);setDeposits([]);setWarnings([]);setExcluded([]);resetChoices();
  if(!drafts.every(bankDraftReady))return;
  try{const parsed=parseDrafts(drafts,pdfResult);setDeposits(parsed.deposits);setWarnings(parsed.warnings);setExcluded(parsed.excluded??[]);setReviewed(true);}
  catch(e){setError(e instanceof Error?e.message:'Review the missing bank details.');}
 }
 function reviewExcludedOwner(index:number){
  const resolved=reviewExcluded[index],row=excluded[index];
  if(!resolved?.reviewable||!resolved.date||!resolved.currency||!resolved.account||!resolved.accountIdentity||resolved.amountCents===null||resolved.amountCents<=0)return;
  const ownerIndex=reviewDeposits.filter(d=>d.kind==='owner').length;
  setDeposits(previous=>[...previous,{kind:'owner',ownerName:'',reference:row.reference??'',source:row.source,sheet:row.sheet,sourceRow:row.sourceRow,date:row.date!,account:row.account!,accountIdentity:row.accountIdentity,currency:row.currency,amountCents:row.amountCents!,description:row.description}]);
  setExcluded(previous=>previous.filter((_,i)=>i!==index));setSkipped(previous=>({...previous,[ownerIndex]:false}));setOwnerPage(Math.floor(ownerIndex/BANK_REVIEW_PAGE_SIZE));
 }
 async function save(){
  if(saving||busy)return;setSaving(true);setError('');
  try{
   if(!protectedBackend)throw new Error('Update the Apps Script deployment to enable receipt-protected bank imports.');
   if(!reviewed||!changes.length)throw new Error('Review the prepared transactions before submitting.');
   if(hasUnresolved)throw new Error('Resolve the missing source details and allocations, or explicitly exclude unresolved items before saving.');
   if(rowCount>500)throw new Error('Import at most 500 payment rows at a time.');
   await onApply(changes,snapshot?latest=>prepareFreshBankImport(snapshot,changes,latest):undefined);
  }catch(e){if(e instanceof BankImportReviewRequired&&snapshot){setAllocations(current=>remapBankAllocationDrafts(snapshot,e.snapshot,current));setReviewSnapshot(e.snapshot);setSelections({});}setError(e instanceof Error?e.message:'Could not save the import.');}finally{setSaving(false);}
 }
 const saveSummary=busy?'Reading original bank evidence…':saving?'Waiting for database confirmation…'
  :!protectedBackend?'Update the Apps Script deployment before saving bank imports.'
  :error?error
  :fileFailures.some(file=>!file.excluded)?'An unreadable file needs review or exclusion.'
  :sheetDrafts.some(draft=>draft.issue&&!draft.excluded)?'A worksheet could not be read automatically. Review its message above.'
  :!reviewed&&sheetDrafts.length?'Confirm the missing source account or currency above; review will update automatically.'
  :missingPdfDetails?'Confirm the missing PDF account or currency above.'
  :Object.keys(ownerReview.errors).length?'Complete or skip the highlighted owner allocations.'
  :rowCount>500?'More than 500 payment rows match. Import fewer files.'
  :reviewed&&!rowCount?'No payment rows are ready to save. Review the transaction results below.'
  :reviewed?`${rowCount} payment rows ready to save.`:'Choose files to begin.';
 return <dialog ref={dialog} className="import-modal bank-statement-modal" aria-labelledby="bank-import-title" onCancel={e=>{e.preventDefault();if(!busy&&!saving)onClose();}}>
  <header className="import-header"><div className="import-header-icon"><FileText size={23}/></div><div><p className="import-eyebrow">BANK RECONCILIATION</p><h2 id="bank-import-title">Import Bank Statement</h2><p>Review bank deposits for {month.label}.</p></div><FormWindowControls onMinimize={background.minimize} onClose={onClose} closeDisabled={busy||saving}/></header>
  <div className="import-content" aria-busy={busy||saving}>
   {error&&<div className="import-alert" role="alert">{error}</div>}
   {!protectedBackend&&<div className="import-warning">Update the Google Apps Script deployment with the supplied Code.gs before saving bank imports. The updated backend tracks receipt identity and prevents the same deposit being allocated beyond its amount. You can still read and review files here.</div>}
   <div className="import-dropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void files(e.dataTransfer.files);}}><div className="import-upload-icon"><Upload size={28}/></div><h3>Bring Your Bank Deposits In</h3><p>Choose RBC or Wells Fargo PDF statements, or bank Excel/CSV exports. The app checks the original amounts, dates, accounts, and references. Review any missing details and excluded credits before saving.</p><input ref={input} className="import-hidden-input" type="file" accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" aria-label="Choose Bank Files" multiple onChange={e=>files(e.target.files)}/><button className="import-button import-button-primary" disabled={busy||saving} onClick={()=>input.current?.click()}>{busy?'Reading Bank Files…':'Choose Bank Files'}</button><small>Up to 25 files / 50 MB total · PDF: 20 MB each · Excel/CSV: 10 MB each<br/>Files are read locally. A limited worksheet sample goes to configured AI only when local layout recognition fails. Column selection is automatic.</small></div>
   {fileFailures.map((file,index)=><div className="import-alert" key={index}><strong>{file.source}</strong><p>{file.message}</p><label><input type="checkbox" disabled={busy||saving} checked={file.excluded} onChange={e=>setFileFailures(previous=>previous.map((row,i)=>i===index?{...row,excluded:e.target.checked}:row))}/> Exclude This Unreadable File</label></div>)}
   {sheetDrafts.length>0&&<BankSpreadsheetMapping drafts={sheetDrafts} disabled={busy||saving} onRetry={()=>void retryPreparation()} onChange={updatePreparedSheets}/>}
   {pdfSources.some(source=>source.needsCurrency||source.needsAccount)&&<section className="bank-pdf-details"><h3>Confirm PDF Source Details</h3><p>These details are not explicit in the extracted statement. Confirm them from the bank account before saving.</p>{pdfSources.filter(row=>row.needsCurrency||row.needsAccount).map(row=><fieldset className="bank-mapping-sheet" disabled={busy||saving} key={row.source}><legend>{row.source}</legend><div className="bank-mapping-fields">{row.needsAccount&&<label>Full Bank Account Number<input inputMode="numeric" autoComplete="off" placeholder="Enter the full source account" value={sourceDetails[row.source]?.account??''} onChange={e=>setSourceDetails(previous=>({...previous,[row.source]:{...previous[row.source],account:e.target.value}}))}/></label>}{row.needsCurrency&&<label>Currency<select aria-label={`Currency For ${row.source}`} value={sourceDetails[row.source]?.currency??''} onChange={e=>{const currency=e.target.value==='CAD'||e.target.value==='USD'?e.target.value:undefined;setSourceDetails(previous=>({...previous,[row.source]:{...previous[row.source],currency}}));}}><option value="">Choose Source Currency</option><option value="CAD">CAD — Canadian Dollar</option><option value="USD">USD — US Dollar</option></select></label>}</div></fieldset>)}</section>}
   <div className="import-guidance"><CheckCircle2 size={19}/><div><strong>Review Before Saving</strong><p>Platform deposits match payout groups and bank accounts. Owner deposits require the configured statement name and a real transaction reference. Missing references are never invented. Original amounts cannot be edited.</p></div></div>
   {warnings.length>0&&<details className="import-warning"><summary>Import Notes ({warnings.length})</summary><ul>{warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}
   {reviewed&&<><BankSourceSummary deposits={reviewDeposits} excluded={reviewExcluded} ready={rowCount} needsDetails={needsDetails}/><BankExcludedCredits rows={reviewExcluded} onReviewOwner={reviewExcludedOwner} disabled={busy||saving}/>{!deposits.length&&<p>No supported deposits are ready to match. Review excluded credits and source details above.</p>}<BankPlatformMatches rows={result.rows} selections={selections} disabled={busy||saving} onSelect={(key,value)=>setSelections(previous=>({...previous,[key]:value}))}/></>}
   {reviewed&&ownerRows.length>0&&<section aria-labelledby="bank-owner-title"><div className="import-section-heading"><h3 id="bank-owner-title">Owner Payments</h3><span>{ownerRows.length} Deposits · {ownerReview.changes.length} Ready</span></div><p className="owner-help">Only a unique exact balance or combination is preselected. Unmatched deposits stay skipped until you choose Edit and confirm the sender, reference, and allocation. You can split a deposit across mapped properties and reporting months. All allocations must equal the original deposit.</p>{snapshot?.ownerAllocationSchema!==1&&<p className="import-warning">Update the Apps Script deployment to allocate a deposit across reporting months.</p>}{ownerRows.slice(currentOwnerPage*BANK_REVIEW_PAGE_SIZE,(currentOwnerPage+1)*BANK_REVIEW_PAGE_SIZE).map((row,offset)=>{const index=currentOwnerPage*BANK_REVIEW_PAGE_SIZE+offset;return <OwnerPaymentReview key={index} row={row} referenceEditable={!originalOwnerDeposits[index]?.reference} balancePreview={ownerReview.balancePreview} values={allocations[index]??allocationDraft(row)} skipped={ownerDepositSkipped(row,skipped[index])} statementNames={statementNames} onEditDeposit={edit=>{setDepositEdits(previous=>({...previous,[index]:edit}));setAllocations(previous=>({...previous,[index]:{}}));setSkipped(previous=>({...previous,[index]:false}));}} disabled={busy||saving} error={ownerReview.errors[index]} onChange={values=>setAllocations(previous=>({...previous,[index]:values}))} onSkip={skip=>setSkipped(previous=>({...previous,[index]:skip}))}/>;})}<BankReviewPager page={currentOwnerPage} total={ownerRows.length} onPage={setOwnerPage} label="Owner Payment Pages"/></section>}
   {rowCount>500&&<div className="import-warning">More than 500 payment rows match. Import fewer files at a time.</div>}
  </div>
  <footer className="import-footer"><button className="import-button import-button-secondary" disabled={busy||saving} onClick={onClose}>Cancel</button><span className="bank-save-summary" role="status">{saveSummary}</span><button className="import-button import-button-primary" disabled={!protectedBackend||!reviewed||!changes.length||rowCount>500||hasUnresolved||busy||saving} onClick={()=>void save()}>{saving?'Saving…':`Save ${rowCount} Payment Rows`}</button></footer>
 </dialog>;
}
