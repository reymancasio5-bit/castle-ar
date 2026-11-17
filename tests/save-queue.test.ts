import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveQueue} from '../src/save-queue.ts';

test('queued writes execute one at a time and retain their results',async()=>{
 const counts:number[]=[];const order:string[]=[];
 const queue=createSaveQueue(n=>counts.push(n));
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const first=queue.enqueue(async()=>{order.push('first');await gate;return 1;});
 const second=queue.enqueue(async()=>{order.push('second');return 2;});
 await Promise.resolve();assert.deepEqual(order,['first']);assert.equal(counts.at(-1),2);
 release();assert.deepEqual(await Promise.all([first,second]),[1,2]);
 assert.deepEqual(order,['first','second']);assert.equal(counts.at(-1),0);
});
test('a rejected write does not strand the next task or replay the failed write',async()=>{
 const queue=createSaveQueue();let attempts=0;
 const first=queue.enqueue(async()=>{attempts++;throw new Error('Unconfirmed write');});
 const second=queue.enqueue(async()=>42);
 await assert.rejects(first,/Unconfirmed/);assert.equal(await second,42);assert.equal(attempts,1);
});

test('repeated submissions share the pending write instead of creating duplicate records',async()=>{
 const queue=createSaveQueue();let writes=0,release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const first=queue.enqueue(async()=>{writes++;await gate;return 'saved';},'same-submission');
 const duplicate=queue.enqueue(async()=>{writes++;return 'duplicate';},'same-submission');
 release();assert.equal(await first,'saved');assert.equal(await duplicate,'saved');assert.equal(writes,1);
 assert.equal(await queue.enqueue(async()=> 'later explicit save','same-submission'),'later explicit save');
});
