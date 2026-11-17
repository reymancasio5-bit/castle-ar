/** Serialize writes without blocking navigation or replaying failed writes. */
export function createSaveQueue(onPending:(count:number)=>void=()=>{}){
 let tail:Promise<unknown>=Promise.resolve();let pending=0;
 const submissions=new Map<string,Promise<unknown>>();
 return {enqueue<T>(work:()=>Promise<T>,key?:string):Promise<T>{
  if(key&&submissions.has(key))return submissions.get(key) as Promise<T>;
  onPending(++pending);
  const result=tail.then(work);
  const settled=result.finally(()=>{if(key)submissions.delete(key);onPending(--pending);});
  if(key)submissions.set(key,settled);
  tail=settled.catch(()=>{});
  return settled;
 }};
}
