import {useEffect,useRef,useState} from 'react';
import {MessageCircle,X,Send,Check,Paperclip,Download,FileText,Upload} from 'lucide-react';
import type {Change,Snapshot} from './types';
import type {AssistantAttachment,AssistantMessage,AssistantReply,AssistantRequest,AssistantImport} from './assistant-types';
import {markdownHtml,downloadReport} from './assistant-content';
import {readAssistantFile} from './assistant-files';
import {money} from './domain';
import CastleMark from './CastleMark';
import './assistant.css';
type Props={snapshot:Snapshot;monthId:string;ask?:(request:AssistantRequest,onProgress?:(label:string)=>void)=>Promise<AssistantReply>;onApply:(revision:string,changes:Change[])=>Promise<void>;onImport:(kind:'bank'|'excel',file:File,monthId:string)=>void};
export default function CastleAssistant({snapshot,monthId,ask,onApply,onImport}:Props) {
 const [open,setOpen]=useState(false);
 const [draft,setDraft]=useState(''),[messages,setMessages]=useState<AssistantMessage[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [proposal,setProposal]=useState<AssistantReply['proposal']>(null),[reviewed,setReviewed]=useState(false);
 const [attached,setAttached]=useState<{data:AssistantAttachment;file:File}|null>(null),[reading,setReading]=useState(false),[progress,setProgress]=useState('Thinking');
 const attachmentInput=useRef<HTMLInputElement>(null);
 const dialog=useRef<HTMLDialogElement>(null),end=useRef<HTMLDivElement>(null),launcher=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(open)dialog.current?.show();else if(dialog.current?.open){dialog.current.close();launcher.current?.focus();}},[open]);
 useEffect(()=>{if(!open)return;const onEscape=(event:KeyboardEvent)=>{if(event.key==='Escape' && (dialog.current?.contains(document.activeElement)||document.activeElement===launcher.current)){event.preventDefault();setOpen(false);}};document.addEventListener('keydown',onEscape);return ()=>document.removeEventListener('keydown',onEscape);},[open]);
 useEffect(()=>{const body=end.current?.parentElement;if(body)body.scrollTop=body.scrollHeight;},[messages,busy,progress]);
 async function attach(file?:File){if(!file||busy||reading)return;setReading(true);setError('');try{setAttached({data:await readAssistantFile(file),file});}catch(e){setError(e instanceof Error?e.message:'Unable to read this file.');}finally{setReading(false);if(attachmentInput.current)attachmentInput.current.value='';}}
 function reviewImport(action:AssistantImport){if(!attached||attached.data.id!==action.attachmentId){setError('Attach the original file again and ask to import it.');return;}if(!snapshot.months.some(m=>m.id===action.monthId)){setError('The target month no longer exists. Please request the import again.');return;}onImport(action.kind,attached.file,action.monthId);setOpen(false);}
 async function send(text:string,reportFormat?:'pdf'|'xlsx'|'txt') {
  if(busy||reading||!text.trim())return;
  setBusy(true);setProgress('Thinking');setError('');setProposal(null);setReviewed(false);setDraft('');
  const history=messages.slice(-4).map(m=>({role:m.role,content:m.report?m.report.title+'\n'+m.report.markdown:m.content}));setMessages(m=>[...m.slice(-19),{role:'user',content:text+(attached?`\n\nAttached: ${attached.data.name}`:'')}]);
  try {
   let answer:AssistantReply;
   if(ask)answer=await ask({message:text,monthId,history,attachment:attached?.data,reportFormat},setProgress);
   else {
    const month=snapshot.months.find(m=>m.id===monthId),properties=month?.properties??[];
    const expected=properties.reduce((s,p)=>s+p.totalCents,0),received=properties.reduce((s,p)=>s+p.payments.reduce((n,r)=>n+(r.amountCents??0),0),0);
    answer={text:`LOCAL DEMO — no AI request was made.\n\n${month?.label??'Selected month'}: ${properties.length} properties.\nExpected: ${money(expected)}\nReceived (column D): ${money(received)}\nOutstanding: ${money(expected-received)}\n\nLive answers, analysis, and edit proposals become available after your administrator configures the Apps Script assistant. This demo always shows the selected month summary.`};
   }
   if(!ask && /report/i.test(text)){
    const format=reportFormat??(/\bpdf\b/i.test(text)?'pdf':/\b(excel|xlsx)\b/i.test(text)?'xlsx':/\b(txt|plain text)\b/i.test(text)?'txt':undefined);
    if(!format)answer={text:'Which file type would you like? PDF is recommended. This local preview uses sample data, not a live AI response.',chooseReportFormat:true};
    else answer={text:'Your local demonstration report is ready.',report:{title:'Castle sample report',markdown:answer.text,format}};
   }
   setMessages(m=>[...m,{role:'assistant',content:answer.text,report:answer.report,importAction:answer.importAction,chooseReportFormat:answer.chooseReportFormat}]);setProposal(answer.proposal);
  }catch(e){setError(e instanceof Error?e.message:'The assistant could not respond.');}
  finally{setBusy(false);}
 }
 async function apply(){if(!proposal||!reviewed||busy)return;setBusy(true);setProgress('Saving reviewed changes');setError('');try{await onApply(proposal.revision,proposal.changes);setProposal(null);setMessages(m=>[...m,{role:'assistant',content:'The reviewed changes were saved successfully.'}]);}catch(e){setError(e instanceof Error?e.message:'Unable to save.');}finally{setBusy(false);}}
 function recordName(change:Change){
  for(const month of snapshot.months)for(const property of month.properties){
   if('propertyId' in change&&change.propertyId===property.id)return `${month.label} · ${property.name}`;
   if('paymentId' in change){const payment=property.payments.find(p=>p.id===change.paymentId);if(payment)return `${month.label} · ${property.name} · ${payment.type} (${payment.id})`;}
  }
  return 'Workspace record';
 }
 function describeChange(change:Change){
  const names:Record<string,string>={name:'Property name',manager:'Account manager',amountCents:'Payment amount',totalCents:'Expected amount',type:'Payment type',payoutDate:'Payout date',bundleCents:'Bundle amount',bankDetails:'Bank account',bankDate:'Bank received date',bankCents:'Bank received amount',verifiedByDaisy:'Daisy verification'};
  if(change.kind==='deleteProperty')return 'Delete this property and all of its payments.';
  if(change.kind==='deletePayment')return 'Delete this payment.';
  if(change.kind==='setTotal')return `Expected amount → ${money(change.amountCents)}`;
  const fields=change.kind==='updatePayment'?change.fields:change.kind==='updateProperty'?{name:change.name,manager:change.manager}:{};
  return Object.entries(fields).map(([key,value])=>`${names[key]??key} → ${value===null||value===''?'Clear value':key.endsWith('Cents')?money(value as number):typeof value==='boolean'?(value?'Verified':'Pending'):String(value)}`).join('\n');
 }
 return <>
  <button ref={launcher} className="assistant-launcher" data-open={open} onClick={()=>setOpen(value=>!value)} aria-label={open?"Minimize Castle Assistant":"Open Castle Assistant"} aria-haspopup="dialog" aria-expanded={open} title="Castle Assistant"><span className="assistant-launcher-symbol" aria-hidden="true"><MessageCircle size={25}/></span></button>
  <dialog ref={dialog} className="castle-assistant" aria-labelledby="assistant-title" onCancel={e=>{e.preventDefault();if(!busy)setOpen(false);}}>
   <header><span className="assistant-header-symbol" aria-hidden="true"><CastleMark/></span><div><h2 id="assistant-title">Castle Assistant</h2></div><button className="icon-button" aria-label="Minimize assistant" onClick={()=>setOpen(false)}><X size={20}/></button></header>
   <div className="assistant-body">
    <p className="assistant-intro">Hi there! How can I help you?</p>
    <div className="assistant-messages" aria-live="polite">{messages.map((m,i)=><article key={i} className={`assistant-message ${m.role}`}><strong>{m.role==='user'?'You':'Castle'}</strong>{m.role==='user'?<p>{m.content}</p>:<div className="assistant-rich-text" dangerouslySetInnerHTML={{__html:markdownHtml(m.report?.markdown??m.content)}}/>}{m.report&&<button className="assistant-artifact" onClick={()=>void downloadReport(m.report!).catch(e=>setError(e instanceof Error?e.message:'Unable to download report.'))}><FileText size={22}/><span><b>{m.report.title}</b><small>Download {m.report.format.toUpperCase()} report</small></span><Download size={18}/></button>}{m.chooseReportFormat&&<div className="assistant-format-options">{[['PDF (recommended)','PDF'],['Excel','Excel'],['Plain text','plain text']].map(([label,format])=><button key={format} disabled={busy} onClick={()=>void send('Generate the requested report as '+format+'.',format==='PDF'?'pdf':format==='Excel'?'xlsx':'txt')}>{label}</button>)}</div>}{m.importAction&&<button className="button secondary" disabled={busy} onClick={()=>reviewImport(m.importAction!)}><Upload size={16}/>Review import</button>}</article>)}{busy&&<div className="assistant-thinking" role="status"><CastleMark/><span>{progress}<span className="assistant-thinking-dots" aria-hidden="true"><i/><i/><i/></span></span></div>}</div>
    {proposal&&<section className="assistant-proposal"><h3>Review proposed changes</h3><p>Nothing has been saved. Check each record and value below.</p>{proposal.changes.map((change,i)=><div key={i}><strong>{recordName(change)}</strong><pre>{describeChange(change)}</pre></div>)}<label><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>I reviewed these changes{proposal.changes.some(c=>c.kind.startsWith('delete'))?' and understand deleted records will be removed.':'.'}</label><div className="assistant-actions"><button className="button secondary" disabled={busy} onClick={()=>setProposal(null)}>Discard</button><button className="button primary" disabled={!reviewed||busy} onClick={()=>void apply()}><Check size={16}/>Apply changes</button></div></section>}
    {error&&<p className="assistant-error" role="alert">{error}</p>}<div ref={end}/>
   </div>
   <footer>{attached&&<div className="assistant-attachment">{attached.data.kind==='image'?<img src={attached.data.dataUrl} alt="Attached screenshot"/>:<FileText size={20}/>}<span title={attached.data.name}>{attached.data.name}</span><button className="icon-button" disabled={busy||reading} aria-label="Remove attachment" onClick={()=>setAttached(null)}><X size={15}/></button></div>}{attached&&<small className="assistant-attachment-note">{attached.data.text?.startsWith('[EXCERPT ONLY:')?'Large file: an excerpt is sent for analysis. Imports use the full file.':'Attachment content is sent with your message.'}</small>}<input ref={attachmentInput} className="sr-only" type="file" tabIndex={-1} accept=".pdf,.xlsx,.xls,.csv,.txt,.md,.png,.jpg,.jpeg,.webp" onChange={e=>void attach(e.target.files?.[0])}/><form onSubmit={e=>{e.preventDefault();void send(draft);}}><button className="assistant-attach-button" type="button" disabled={busy||reading} onClick={()=>attachmentInput.current?.click()} aria-label="Attach file or screenshot" title="Attach file or screenshot"><Paperclip size={20}/></button><label className="sr-only" htmlFor="assistant-question">Ask about Castle</label><textarea id="assistant-question" rows={1} maxLength={2000} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.nativeEvent.keyCode!==229){e.preventDefault();if(!e.repeat)void send(draft);}}} onPaste={e=>{const file=e.clipboardData.files[0];if(file){e.preventDefault();void attach(file);}}} placeholder={reading?'Reading attachment?':'Ask about Castle?'} disabled={busy||reading}/><button className="button primary" type="submit" disabled={busy||reading||!draft.trim()} aria-label="Send question"><Send size={18}/></button></form></footer>
  </dialog>
 </>;
}
