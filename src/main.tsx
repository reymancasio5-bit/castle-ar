import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { createApi, validateEndpoint } from './api.ts';
import { createPreviewApi } from './preview-api.ts';
import './styles.css';
import './neutral-theme.css';
import './interactions.css';
import './motion.css';
import './filter-controls.css';
declare global { interface Window { CASTLE_CONFIG?: { appsScriptUrl?:string } } }
function storedEndpoint(){
 if(import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview')==='1') return '';
 const publishedEndpoint=window.CASTLE_CONFIG?.appsScriptUrl?.trim();
 if(publishedEndpoint) return publishedEndpoint;
 try{return localStorage.getItem('castle-apps-script-url')||''}catch{return ''}
}
function Root(){
 const [endpoint]=useState(storedEndpoint);
 const api=useMemo(()=>{try{return endpoint?createApi(endpoint):createPreviewApi()}catch{return createPreviewApi()}},[endpoint]);
 const valid=(()=>{try{return !!endpoint&&!!validateEndpoint(endpoint)}catch{return false}})();
 return <App api={api} configured={valid}/>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
