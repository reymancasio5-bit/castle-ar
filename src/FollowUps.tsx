import {useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {MessageSquare, Paperclip, Pencil, X, Check, ExternalLink} from 'lucide-react';
import type {AccountManager, Change, FollowUpAttachment, FollowUpStatus, Property} from './types.ts';
import {balance, collected, money} from './domain.ts';
import {buildFollowUpChange, followUpDirty, followUpDraft, followUpStatuses, isSafeScreenshot, prepareScreenshot} from './follow-ups.ts';
import type {FollowUpDraft} from './follow-ups.ts';
import './follow-ups.css';
import ManagerSelect from './ManagerSelect';
export interface FollowUpsProps {properties:Property[];managers:AccountManager[];revision:string;onSave:(revision:string,change:Change)=>Promise<void>;onOpen:(property:Property)=>void;onDirtyChange?:(dirty:boolean)=>void}
interface Edit {id:string;revision:string;initial:FollowUpDraft;draft:FollowUpDraft}
function ScreenshotViewer({attachment,onClose}:{attachment:FollowUpAttachment;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [visible,setVisible]=useState(false);const title=useId();
 useEffect(()=>{
  const element=dialog.current!;const previousOverflow=document.body.style.overflow;const trigger=document.activeElement;
  element.showModal();document.body.style.overflow='hidden';
  element.getBoundingClientRect(); // Establish the closed style before starting the transition.
  const frame=requestAnimationFrame(()=>setVisible(true));
  return ()=>{cancelAnimationFrame(frame);if(timer.current)clearTimeout(timer.current);element.close();document.body.style.overflow=previousOverflow;if(trigger instanceof HTMLElement && trigger.isConnected)trigger.focus();};
 },[]);
 function close(){if(timer.current)return;setVisible(false);timer.current=setTimeout(onClose,window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:200);}
 return createPortal(<dialog ref={dialog} className={`fu-viewer${visible?' is-visible':''}`} aria-labelledby={title} onCancel={event=>{event.preventDefault();close();}} onClick={event=>{if(event.target===event.currentTarget)close();}}>
  <div className="fu-viewer-content"><header><span id={title}>{attachment.name}</span><button type="button" className="icon-button" aria-label="Close photo viewer" onClick={close} autoFocus><X size={22}/></button></header><img src={attachment.dataUrl} alt={attachment.name}/></div>
 </dialog>,document.body);
}
function Screenshots({attachments,onRemove,disabled}:{attachments:FollowUpAttachment[];onRemove?:(index:number)=>void;disabled?:boolean}) {
 const [viewing,setViewing]=useState<FollowUpAttachment|null>(null);
 return <div className="fu-screenshots">{attachments.map((attachment,index)=><div className="fu-screenshot" key={`${index}-${attachment.name}`}>
  {isSafeScreenshot(attachment) ? <button type="button" className="fu-photo-open" aria-label={`View photo ${attachment.name}`} onClick={()=>setViewing(attachment)}><img src={attachment.dataUrl} alt=""/><span>{attachment.name}</span></button> : <span className="fu-invalid-image">Screenshot unavailable: {attachment.name}</span>}
  {onRemove && <button type="button" className="icon-button" disabled={disabled} aria-label={`Remove screenshot ${attachment.name}`} onClick={()=>onRemove(index)}><X size={16}/></button>}
 </div>)}{viewing && <ScreenshotViewer attachment={viewing} onClose={()=>setViewing(null)}/>}</div>;
}
export default function FollowUps({properties,managers,revision,onSave,onOpen,onDirtyChange}:FollowUpsProps) {
 const [edit,setEdit]=useState<Edit|null>(null);
 const [saving,setSaving]=useState(false);const [processing,setProcessing]=useState(false);
 const [error,setError]=useState('');const [success,setSuccess]=useState('');
 const fileInput=useRef<HTMLInputElement>(null);
 const dirty=!!edit && followUpDirty(edit.initial,edit.draft);const locked=!!edit||saving||processing;
 const dirtyCallback=useRef(onDirtyChange);dirtyCallback.current=onDirtyChange;
 useEffect(()=>{onDirtyChange?.(locked);},[locked,onDirtyChange]);
 useEffect(()=>()=>{dirtyCallback.current?.(false);},[]);
 useEffect(()=>{
  if(!locked)return;
  const protectDraft=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',protectDraft);
  return ()=>window.removeEventListener('beforeunload',protectDraft);
 },[locked]);
 const update=(patch:Partial<FollowUpDraft>)=>setEdit(current=>current ? {...current,draft:{...current.draft,...patch}} : null);
 const start=(property:Property)=>{if(locked)return;onDirtyChange?.(true);const draft=followUpDraft(property);setEdit({id:property.id,revision,initial:structuredClone(draft),draft});setError('');setSuccess('');};
 const cancel=()=>{if(saving||processing)return;setEdit(null);setError('');};
 async function upload(files:File[]) {
  if(!edit||saving||processing||!files.length)return;
  setError('');
  if(files.length+edit.draft.attachments.length>3){setError('Attach up to three screenshots. Remove one before adding more.');return;}
  setProcessing(true);
  try {const attachments:FollowUpAttachment[]=[];for(const file of files)attachments.push(await prepareScreenshot(file));update({attachments:[...edit.draft.attachments,...attachments]});}
  catch(cause){setError(cause instanceof Error ? cause.message : 'Could not prepare this screenshot.');}
  finally {setProcessing(false);}
 }
 async function save() {
  if(!edit||saving||processing||!dirty)return;
  setError('');setSaving(true);
  try {await onSave(edit.revision,buildFollowUpChange(edit.id,edit.draft));setSuccess(`Follow-up saved for ${properties.find(p=>p.id===edit.id)?.name??'property'}.`);setEdit(null);}
  catch(cause){setError(cause instanceof Error ? cause.message : 'Could not save. Your draft is still here.');}
  finally {setSaving(false);}
 }
 const visible=properties;
 return <section className="follow-ups" aria-label="Property Follow-Ups">
  {locked&&<p className="fu-editing-note" role="status">Save or cancel your update before switching views.</p>}
  {success && <p className="fu-success" role="status"><Check size={16}/>{success}</p>}
  <div className="fu-column-labels" aria-hidden="true"><span>Property & Balance</span><span>Status & Account Manager</span><span>Conversation Notes</span><span/></div>
  <div className="fu-list">{visible.map(property=>{
   const active=edit?.id===property.id;const draft=active ? edit.draft : followUpDraft(property);const outstanding=balance(property);
   return <article className={`fu-row${active?' is-editing':''}`} key={property.id} aria-label={`Follow-up for ${property.name}`}>
    <div className="fu-property"><h3>{property.name}</h3><strong className={outstanding>0?'fu-outstanding':'fu-paid'}>{money(Math.abs(outstanding))} <small>{outstanding<0?'credit':outstanding===0?'outstanding · Paid':'outstanding'}</small></strong><span>{money(collected(property))} collected of {money(property.totalCents)}</span><button type="button" className="button quiet compact" disabled={locked} onClick={()=>onOpen(property)}>View Payments <ExternalLink size={13}/></button></div>
    <div className="fu-status-manager">{active ? <><label>Follow-Up Status<select aria-label={`Follow-up status for ${property.name}`} disabled={saving||processing} value={draft.status} onChange={event=>update({status:event.target.value as FollowUpStatus})}>{followUpStatuses.map(s=><option value={s.value} key={s.value}>{s.label}</option>)}</select></label><label>Account Manager<ManagerSelect label={`Account manager for ${property.name}`} managers={managers} currentValue={property.manager} disabled={saving||processing} value={draft.manager} onChange={manager=>update({manager})}/><small>Select a saved record, or Unassigned.</small></label></> : <><span className={`fu-status fu-status-${draft.status}`}>{followUpStatuses.find(s=>s.value===draft.status)?.label??"Not Contacted"}</span><span className="fu-manager-label">Account Manager</span><strong className="fu-manager">{draft.manager||'Unassigned'}</strong></>}</div>
    <div className="fu-notes">{active ? <><label>Conversation Notes<textarea aria-label={`Conversation notes for ${property.name}`} disabled={saving||processing} rows={4} maxLength={5000} value={draft.note} placeholder="What did the owner say? Add a next step or payment promise…" onChange={event=>update({note:event.target.value})}/></label><span className="fu-character-count">{draft.note.length.toLocaleString()} / 5,000</span></> : <><span className="fu-note-label">Conversation Notes</span><p className={!draft.note?'fu-no-note':''}>{draft.note||'No conversation notes yet.'}</p></>}
     <Screenshots attachments={draft.attachments} disabled={saving||processing} onRemove={active ? index=>update({attachments:draft.attachments.filter((_,i)=>i!==index)}) : undefined}/>
     {active && <><input className="sr-only" ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={saving||processing||draft.attachments.length>=3} aria-label={`Attach screenshots for ${property.name}`} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';void upload(files);}}/><button type="button" className="button secondary compact fu-attach" disabled={saving||processing||draft.attachments.length>=3} onClick={()=>fileInput.current?.click()}><Paperclip size={14}/>{processing?'Preparing screenshots…':`Attach screenshot (${draft.attachments.length}/3)`}</button><p className="fu-image-help">PNG, JPEG, or WebP · up to 10 MB each. Images are compressed for storage; check the preview for readability.</p></>}
    </div>
    <div className="fu-row-action">{!active && <button type="button" className="button secondary compact" disabled={locked} onClick={()=>start(property)} aria-label={`Edit follow-up for ${property.name}`}><Pencil size={14}/>Edit</button>}</div>
    {active && <div className="fu-edit-footer">{error && <p className="fu-error" role="alert">{error}</p>}{processing && <p role="status" className="fu-processing">Preparing screenshot previews…</p>}<span className="fu-draft-hint">{dirty?"Unsaved Changes":'Update the status, notes, or account manager.'}</span><div><button type="button" className="button secondary" disabled={saving||processing} onClick={cancel}>Cancel</button><button type="button" className="button primary" disabled={!dirty||saving||processing} onClick={()=>void save()}>{saving?'Saving…':"Save Follow-Up"}</button></div></div>}
   </article>;
  })}</div>
  {!visible.length && <div className="fu-empty"><MessageSquare size={26}/><h3>No follow-ups in this view</h3><p>{properties.length?'Choose another status to see more properties.':'Properties will appear here once they are added to this month.'}</p></div>}
 </section>;
}

