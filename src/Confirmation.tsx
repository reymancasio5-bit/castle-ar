import {createContext,useCallback,useContext,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {AlertTriangle,Trash2,X} from 'lucide-react';
import {EXIT_DURATION_MS} from './Presence';
import './import.css';
import './confirmation.css';

type Options={title:string;message:string;confirmLabel:string;destructive?:boolean};
type Confirm=(options:Options)=>Promise<boolean>;
const ConfirmationContext=createContext<Confirm|null>(null);

/** Shared app confirmation; no browser alert/confirm/prompt UI. */
export function ConfirmationProvider({children}:{children:ReactNode}){
 const [request,setRequest]=useState<Options|null>(null);
 const [exiting,setExiting]=useState(false);
 const closing=useRef(false),exitTimer=useRef<number|undefined>(undefined);
 const pending=useRef<((answer:boolean)=>void)|null>(null);
 const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null);
 const titleId=useId(),messageId=useId();
 const confirm=useCallback<Confirm>(options=>{
  // A second click must never create a second pending deletion.
  if(pending.current)return Promise.resolve(false);
  return new Promise<boolean>(resolve=>{pending.current=resolve;setRequest(options);});
 },[]);
 function settle(answer:boolean){
  if(closing.current||!pending.current)return;
  closing.current=true;setExiting(true);
  const finish=()=>{const resolve=pending.current;pending.current=null;dialog.current?.close();setRequest(null);setExiting(false);closing.current=false;exitTimer.current=undefined;resolve?.(answer);};
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)finish();
  else exitTimer.current=window.setTimeout(finish,EXIT_DURATION_MS);
 }
 useEffect(()=>{
  if(request){dialog.current?.showModal();cancel.current?.focus();}
 },[request]);
 useEffect(()=>()=>{if(exitTimer.current!==undefined)window.clearTimeout(exitTimer.current);pending.current?.(false);pending.current=null;},[]);
 return <ConfirmationContext.Provider value={confirm}>{children}
  <dialog ref={dialog} className="import-modal confirmation-dialog" data-exiting={exiting} role="alertdialog" aria-labelledby={titleId} aria-describedby={messageId} onKeyDown={e=>{if(closing.current){e.preventDefault();e.stopPropagation();}}} onCancel={e=>{e.preventDefault();settle(false);}} onClick={e=>{if(e.target===e.currentTarget)settle(false);}}>
   {request&&<><header className="import-header"><div className="import-header-icon" aria-hidden="true">{request.destructive?<Trash2 size={23}/>:<AlertTriangle size={23}/>}</div><div><p className="import-eyebrow">CONFIRMATION</p><h2 id={titleId}>{request.title}</h2></div><button type="button" className="import-icon-button" aria-label="Cancel confirmation" disabled={exiting} onClick={()=>settle(false)}><X size={21}/></button></header>
   <div className="import-content confirmation-content"><p id={messageId}>{request.message}</p></div>
   <footer className="import-footer"><button ref={cancel} type="button" className="import-button import-button-secondary" disabled={exiting} onClick={()=>settle(false)}>Cancel</button><button type="button" className={`import-button ${request.destructive?'confirmation-danger':'import-button-primary'}`} disabled={exiting} onClick={()=>settle(true)}>{request.confirmLabel}</button></footer></>}
  </dialog>
 </ConfirmationContext.Provider>;
}
export function useConfirmation():Confirm{
 const confirm=useContext(ConfirmationContext);
 if(!confirm)throw new Error('ConfirmationProvider is required.');
 return confirm;
}
