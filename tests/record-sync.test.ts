import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordSync} from '../src/record-sync.ts';
const deferred=<T>()=>{let resolve!:(v:T)=>void;let reject!:(v:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){const reads:ReturnType<typeof deferred<string>>[]=[];const applied:string[]=[];const errors:string[]=[];const loading:boolean[]=[];const sync=createRecordSync({read:()=>{const d=deferred<string>();reads.push(d);return d.promise;},apply:s=>applied.push(s),loading:v=>loading.push(v),error:e=>errors.push(e)});return {sync,reads,applied,errors,loading};}
test('a late read cannot replace a save and a queued refresh catches up',async()=>{
 const f=fixture();const read=f.sync.refresh();f.sync.setPaused(true);f.sync.acceptSaved('saved');f.sync.setPaused(false);f.reads[0].resolve('old');await read;
 assert.deepEqual(f.applied,['saved']);assert.equal(f.reads.length,2);f.reads[1].resolve('latest');await Promise.resolve();assert.deepEqual(f.applied,['saved','latest']);
});
test('editing blocks reads and discards responses that started before editing',async()=>{
 const f=fixture();const read=f.sync.refresh();f.sync.setPaused(true);f.reads[0].resolve('stale');await read;assert.deepEqual(f.applied,[]);
 await f.sync.refresh(true);assert.equal(f.reads.length,1);f.sync.setPaused(false);assert.equal(f.reads.length,2);f.reads[1].resolve('after edit');await Promise.resolve();assert.deepEqual(f.applied,['after edit']);
});
test('repeated background requests never overlap and coalesce into one follow-up',async()=>{
 const f=fixture();const read=f.sync.refresh(true);await f.sync.refresh(true);await f.sync.refresh(true);assert.equal(f.reads.length,1);f.reads[0].resolve('first');await read;assert.equal(f.reads.length,2);f.reads[1].resolve('next');await Promise.resolve();assert.equal(f.reads.length,2);
});
test('failed reads retain current data and future refresh can recover',async()=>{
 const f=fixture();f.sync.acceptSaved('current');const read=f.sync.refresh(true);f.reads[0].reject(new Error('Offline'));await read;assert.deepEqual(f.applied,['current']);assert.equal(f.errors.at(-1),'Offline');
 const retry=f.sync.refresh(true);f.reads[1].resolve('recovered');await retry;assert.equal(f.applied.at(-1),'recovered');assert.equal(f.errors.at(-1),'');
});
test('disposed controllers never apply late data or schedule another read',async()=>{
 const f=fixture();const read=f.sync.refresh();await f.sync.refresh(true);f.sync.dispose();f.reads[0].resolve('late');await read;await f.sync.refresh();assert.deepEqual(f.applied,[]);assert.equal(f.reads.length,1);
});

test('automatic recovery clears both foreground and background read errors',async()=>{
 let fail=true;const errors=new Map<boolean,string>();
 const sync=createRecordSync({read:async()=>{if(fail)throw new Error('Offline');return 'fresh';},apply:()=>{},loading:()=>{},error:(message,background)=>errors.set(background,message)});
 await sync.refresh();assert.equal(errors.get(false),'Offline');fail=false;await sync.refresh(true);assert.equal(errors.get(false),'');assert.equal(errors.get(true),'');
});
