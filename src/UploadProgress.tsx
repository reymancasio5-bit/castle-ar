import {useEffect,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {dismissProgress,getProgress,progressPercent,subscribeProgress} from './operation-progress';
import './upload-progress.css';

export default function UploadProgress(){
 const operations=useSyncExternalStore(subscribeProgress,getProgress);
 const [host,setHost]=useState<Element>(document.body);
 useEffect(()=>{
  const sync=()=>setHost(Array.from(document.querySelectorAll('dialog[open]')).at(-1)??document.body);
  const observer=new MutationObserver(sync);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});sync();
  return ()=>observer.disconnect();
 },[]);
 if(!operations.length)return null;
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
   </section>;
  })}
 </aside>,host);
}
