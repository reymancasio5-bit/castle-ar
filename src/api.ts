import type { Change, Snapshot } from './types.ts';
type Reply = {ok:boolean; snapshot?:Snapshot; pending?:boolean; error?:{code:string;message:string}};
type Payload = {requestId:string; revision:string; changes:Change[]};
type Transport = {get:(params:Record<string,string>)=>Promise<Reply>;post:(payload:Payload)=>()=>void;pause:(ms:number)=>Promise<void>};
export function validateEndpoint(input:string):string {
 const url=new URL(input.trim());
 if(url.protocol!=='https:' || url.hostname!=='script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.username || url.password) throw new Error('Use the deployed Google Apps Script URL ending in /exec.');
 return url.origin+url.pathname;
}
function jsonp(endpoint:string, params:Record<string,string>):Promise<Reply> {
 return new Promise((resolve,reject)=>{
  const callback='castleCallback_'+crypto.randomUUID().replace(/-/g,'');
  const script=document.createElement('script');
  const globals=window as unknown as Record<string,unknown>;
  const cleanup=()=>{clearTimeout(timer);script.remove();delete globals[callback]};
  const timer=setTimeout(()=>{cleanup();reject(new Error('Google Sheets did not respond. Check the deployment URL and that access is set to Anyone.'));},20000);
  globals[callback]=(reply:Reply)=>{cleanup();resolve(reply)};
  script.onerror=()=>{cleanup();reject(new Error('Unable to reach Apps Script. Check your connection and deployment access.'))};
  const url=new URL(endpoint); Object.entries({...params,callback,_:String(Date.now())}).forEach(([k,v])=>url.searchParams.set(k,v));
  script.src=url.href;document.head.appendChild(script);
 });
}
function submitForm(endpoint:string,payload:Payload) {
 const frame=document.createElement('iframe');frame.name='castle_write_'+payload.requestId;frame.hidden=true;frame.title='Saving to Google Sheets';
 const form=document.createElement('form');form.action=endpoint;form.method='POST';form.target=frame.name;form.hidden=true;
 const input=document.createElement('input');input.type='hidden';input.name='payload';input.value=JSON.stringify(payload);form.appendChild(input);
 document.body.append(frame,form);form.submit();
 return ()=>{form.remove();frame.remove()};
}
function checked(reply:Reply):Snapshot {
 if(!reply.ok) throw new Error(reply.error?.message || 'Google Sheets could not complete this request.');
 if(!reply.snapshot || !Array.isArray(reply.snapshot.months) || !reply.snapshot.revision) throw new Error('The Apps Script response is incomplete. Deploy the supplied Code.gs and try again.');
 return reply.snapshot;
}
export function createApi(input:string, transport?:Transport) {
 const endpoint=validateEndpoint(input);
 const io=transport??{get:(p:Record<string,string>)=>jsonp(endpoint,p),post:(p:Payload)=>submitForm(endpoint,p),pause:(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))};
 return {
  read:async()=>checked(await io.get({action:'read'})),
  save:async(revision:string,changes:Change[])=>{
   const requestId=crypto.randomUUID();const cleanup=io.post({requestId,revision,changes});
   try {
    for(let attempt=0;attempt<30;attempt++) {
     await io.pause(attempt===0?700:1500);
     const reply=await io.get({action:'status',requestId});
     if(!reply.pending) return checked(reply);
    }
    throw new Error('Save was not confirmed. It may have completed; refresh Google Sheets before trying again.');
   } finally {cleanup()}
  }
 };
}
