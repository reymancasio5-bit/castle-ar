export type Progress = {label:string;completed?:number;total?:number;unit?:string};
export type ReportProgress = (progress:Progress)=>void;
export type OperationProgress = Progress & {id:number;title:string;state:'working'|'complete'|'error'};
let sequence=0;
let operations:OperationProgress[]=[];
const listeners=new Set<()=>void>();
export const getProgress=()=>operations;
export function subscribeProgress(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
function publish(){for(const listener of listeners)listener();}
export function dismissProgress(id:number){operations=operations.filter(p=>p.id!==id);publish();}
export function progressPercent(progress:Progress):number|undefined {
 if(!Number.isFinite(progress.completed)||!Number.isFinite(progress.total)||progress.total!<=0)return undefined;
 return Math.max(0,Math.min(100,Math.floor(progress.completed!/progress.total!*100)));
}
/** Percentages describe completed work in the current stage, never elapsed time. */
export async function runProgress<T>(title:string,work:(report:ReportProgress)=>Promise<T>,parent?:ReportProgress):Promise<T>{
 if(parent)return work(parent);
 const id=++sequence;
 operations=[...operations.filter(p=>p.state==='working'),{id,title,label:'Preparing',state:'working'}];publish();
 const report:ReportProgress=progress=>{operations=operations.map(p=>p.id===id?{id,title,state:'working',...progress}:p);publish();};
 try{
  const result=await work(report);
  operations=operations.map(p=>p.id===id?{...p,label:'Complete',completed:1,total:1,unit:undefined,state:'complete'}:p);publish();
  if(typeof window!=='undefined'&&typeof window.setTimeout==='function')window.setTimeout(()=>dismissProgress(id),4000);
  return result;
 }catch(error){
  operations=operations.map(p=>p.id===id?{...p,label:error instanceof Error?error.message:'Unable to complete this operation.',completed:undefined,total:undefined,state:'error'}:p);publish();
  throw error;
 }
}
export const yieldToBrowser=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
export async function readFileBytes(file:File,report:ReportProgress):Promise<ArrayBuffer>{
 report({label:'Reading File',completed:0,total:file.size,unit:'bytes'});
 // Node-based import tests use Blob; browsers provide measured FileReader events.
 if(typeof FileReader==='undefined'){
  const data=await file.arrayBuffer();report({label:'Reading File',completed:data.byteLength,total:file.size,unit:'bytes'});return data;
 }
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onprogress=event=>report({label:'Reading File',completed:event.loaded,total:event.lengthComputable?event.total:undefined,unit:'bytes'});
  reader.onerror=()=>reject(new Error('The file could not be read. Please select it again.'));
  reader.onabort=()=>reject(new Error('File reading was cancelled.'));
  reader.onload=()=>{report({label:'Reading File',completed:file.size,total:file.size,unit:'bytes'});resolve(reader.result as ArrayBuffer);};
  reader.readAsArrayBuffer(file);
 });
}
