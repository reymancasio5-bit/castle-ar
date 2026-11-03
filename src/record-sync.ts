type SyncOptions<T>={read:()=>Promise<T>;apply:(value:T)=>void;loading:(value:boolean)=>void;error:(message:string,background:boolean)=>void};

/** Serialize reads and invalidate their results whenever editing or a save starts. */
export function createRecordSync<T>(options:SyncOptions<T>){
 let generation=0,paused=false,reading=false,pending=false,disposed=false;
 async function refresh(background=false):Promise<void>{
  if(disposed)return;
  if(paused||reading){pending=true;return;}
  pending=false;reading=true;const started=generation;
  if(!background)options.loading(true);
  try{
   const next=await options.read();
   if(!disposed&&!paused&&started===generation){options.apply(next);options.error('',false);options.error('',true);}
  }catch(cause){
   if(!disposed&&!paused&&started===generation)options.error(cause instanceof Error?cause.message:'Could not refresh records.',background);
  }finally{
   reading=false;
   if(!disposed&&started===generation&&!background)options.loading(false);
   if(!disposed&&!paused&&pending)void refresh(true);
  }
 }
 return {
  refresh,
  setPaused(next:boolean){
   if(disposed||paused===next)return;
   paused=next;
   if(next){generation++;pending=true;options.loading(false);}
   else if(pending&&!reading)void refresh(true);
  },
  acceptSaved(next:T){if(disposed)return;generation++;options.apply(next);options.error('',false);options.error('',true);options.loading(false);},
  dispose(){disposed=true;generation++;pending=false;},
 };
}
