import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExternalLink, Link2, X, CheckCircle2 } from 'lucide-react';
import App from './App.tsx';
import { createApi, validateEndpoint } from './api.ts';
import { createPreviewApi } from './preview-api.ts';
import './styles.css';
import './connection.css';
import './neutral-theme.css';
declare global { interface Window { CASTLE_CONFIG?: { appsScriptUrl?:string } } }
function storedEndpoint(){try{return localStorage.getItem('castle-apps-script-url')||window.CASTLE_CONFIG?.appsScriptUrl||''}catch{return window.CASTLE_CONFIG?.appsScriptUrl||''}}
function Root(){
 const [endpoint,setEndpoint]=useState(storedEndpoint);
 const [show,setShow]=useState(false);
 const [draft,setDraft]=useState(endpoint);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 const api=useMemo(()=>{try{return endpoint?createApi(endpoint):createPreviewApi()}catch{return createPreviewApi()}},[endpoint]);
 const valid=(()=>{try{return !!endpoint&&!!validateEndpoint(endpoint)}catch{return false}})();
 useEffect(()=>{if(show)dialog.current?.showModal();else dialog.current?.close()},[show]);
 async function connect(e:React.FormEvent){
  e.preventDefault();setError('');setBusy(true);
  try {const next=validateEndpoint(draft);await createApi(next).read();try{localStorage.setItem('castle-apps-script-url',next)}catch{/* still connected for this session */}setEndpoint(next);setShow(false)}
  catch(err){setError(err instanceof Error?err.message:'Unable to connect.')}finally{setBusy(false)}
 }
 return <><App key={endpoint} api={api} configured={valid} onConfigure={()=>{setDraft(endpoint);setError('');setShow(true)}}/>
 <dialog ref={dialog} className="connection-modal" onCancel={e=>{if(busy)e.preventDefault();else setShow(false)}} aria-labelledby="connection-title">
  <form onSubmit={connect}>
   <div className="connection-head"><div className="connection-symbol"><Link2 size={24}/></div><button type="button" className="connection-close" aria-label="Close connection settings" onClick={()=>setShow(false)} disabled={busy}><X size={20}/></button></div>
   <p className="connection-eyebrow">YOUR SHARED WORKSPACE</p><h2 id="connection-title">Connect Google Sheets</h2>
   <p className="connection-intro">Your spreadsheet is the database. Once connected, everyone using this app sees and edits the same records.</p>
   <ol className="connection-steps">
    <li><span>1</span><div>Open your sheet’s <strong>Extensions → Apps Script</strong>.<br/><a href="./Code.gs" download>Download Code.gs</a> and paste it into the editor.</div></li>
    <li><span>2</span><div>Add the <strong>Google Sheets API</strong> under Services. Deploy as a <strong>Web app</strong>, executing as you, with access set to <strong>Anyone</strong>.</div></li>
    <li><span>3</span><div>Paste the deployment URL below. To connect all visitors automatically, put this same URL in <code>public/config.js</code> and publish.</div></li>
   </ol>
   <label className="connection-label" htmlFor="script-url">Apps Script web app URL</label>
   <input id="script-url" type="url" required value={draft} onChange={e=>setDraft(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" disabled={busy}/>
   <p className="connection-note">No login is required. Anyone who can reach this deployment can read and update its records.</p>
   {error&&<p role="alert" className="connection-error">{error}</p>}
   <div className="connection-actions"><a href="https://docs.google.com/spreadsheets/d/1EGS6cj8WKfUlH8ayk5cXaB9KW53xu7vEbl4oboAJxPY/edit" target="_blank" rel="noreferrer">Open source sheet <ExternalLink size={13}/></a><button type="submit" disabled={busy}>{busy?'Testing connection…':<><CheckCircle2 size={16}/>Connect sheet</>}</button></div>
  </form>
 </dialog></>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
