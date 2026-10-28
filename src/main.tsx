import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { createApi, validateEndpoint } from './api.ts';
import { createPreviewApi } from './preview-api.ts';
import './styles.css';
import './neutral-theme.css';
import './interactions.css';
declare global { interface Window { CASTLE_CONFIG?: { appsScriptUrl?:string } } }
function storedEndpoint(){try{return localStorage.getItem('castle-apps-script-url')||window.CASTLE_CONFIG?.appsScriptUrl||''}catch{return window.CASTLE_CONFIG?.appsScriptUrl||''}}
function Root(){
 const [endpoint]=useState(storedEndpoint);
 const api=useMemo(()=>{try{return endpoint?createApi(endpoint):createPreviewApi()}catch{return createPreviewApi()}},[endpoint]);
 const valid=(()=>{try{return !!endpoint&&!!validateEndpoint(endpoint)}catch{return false}})();
 return <App api={api} configured={valid}/>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
