import {useEffect,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {dismissProgress,getProgress,progressPercent,subscribeProgress} from './operation-progress';
import './upload-progress.css';
import {getBackgroundPanels,subscribeBackgroundPanels} from './background-panels';

export default function UploadProgress(){
 const operations=useSyncExternalStore(subscribeProgress,getProgress);
 const panels=useSyncExternalStore(subscribeBackgroundPanels,getBackgroundPanels);
 const working=operations.some(p=>p.state==='working');
 const needsTab=working||panels.length>0;
 useEffect(()=>{
  if(!needsTab)return;
  const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);
 },[needsTab]);
 const [host,setHost]=useState<Element>(document.body);
 useEffect(()=>{
  const sync=()=>setHost(Array.from(document.querySelectorAll('dialog[open]')).at(-1)??document.body);
  const observer=new MutationObserver(sync);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});sync();
  return ()=>observer.disconnect();
 },[]);
 if(!operations.length&&!panels.length)return null;
 // Render inside the active modal so its top layer cannot obscure progress.
 return createPortal(<aside className="upload-progress-panel" aria-label="File And Save Progress">
  {operations.map(operation=>{
   const percent=progressPercent(operation);
   return <section className="upload-progress-item" key={operation.id}>
    <div className="upload-progress-heading"><strong>{operation.title}</strong>{operation.state!=='working'&&<button type="button" aria-label="Dismiss Progress" onClick={()=>dismissProgress(operation.id)}>×</button>}</div>
    <div className="upload-progress-status" role={operation.state==='error'?'alert':'status'}><span>{operation.label}</span>{percent!==undefined&&<b>{percent}%</b>}</div>
    {operation.state!=='error'&&<progress max={100} value={percent} aria-label={`${operation.title}: ${operation.label}`} aria-valuetext={percent===undefined?'Waiting for measurable progress':`${percent}%`}/>}
    {operation.state==='working'&&operation.total!==undefined&&<small>{operation.completed?.toLocaleString()} / {operation.total.toLocaleString()} {operation.unit??'steps'} · current stage</small>}
    {operation.state==='working'&&percent===undefined&&<small>This stage has no measurable total yet. Completion is not confirmed.</small>}
    {operation.open&&operation.state!=='complete'&&<button type="button" className="button secondary compact" onClick={operation.open}>View Task</button>}
   </section>;
  })}
  {panels.map(panel=><section className="upload-progress-item" key={panel.id}><div className="upload-progress-heading"><strong>{panel.title}</strong></div><p>{panel.busy?'Running in the background. You can keep browsing.':'Your form is ready. Review the result or any required corrections.'}</p><button type="button" className="button secondary compact" onClick={panel.open}>{panel.busy?'View Form':'Return To Form'}</button></section>)}
  {working&&<p className="upload-background-note">Keep this tab open until your tasks finish.</p>}
 </aside>,host);
}
