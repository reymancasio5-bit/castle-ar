import test from 'node:test';
import assert from 'node:assert/strict';
import {getProgress,progressPercent,readFileBytes,runProgress} from '../src/operation-progress.ts';

test('percentages use actual work and leave unknown totals indeterminate',()=>{
 assert.equal(progressPercent({label:'Reading',completed:25,total:200}),12);
 for(const total of [undefined,0,NaN,Infinity])assert.equal(progressPercent({label:'Reading',completed:25,total}),undefined);
});
test('failed work never leaves a successful 100 percent state',async()=>{
 await assert.rejects(runProgress('Broken File',async report=>{report({label:'Reading',completed:10,total:10});throw new Error('Invalid file');}),/Invalid file/);
 const state=getProgress().find(p=>p.title==='Broken File')!;
 assert.equal(state.state,'error');assert.equal(progressPercent(state),undefined);
});
test('FileReader reports measured bytes and propagates read failures',async()=>{
 const original=globalThis.FileReader;
 let reader:any;
 class Reader {onprogress:any;onload:any;onerror:any;onabort:any;result:any;readAsArrayBuffer(){reader=this;}}
 globalThis.FileReader=Reader as any;
 try{
  const events:any[]=[];
  const promise=readFileBytes(new File(['abcdefgh'],'test.txt'),p=>events.push(p));
  reader.onprogress({loaded:3,total:8,lengthComputable:true});
  assert.equal(progressPercent(events.at(-1)),37);
  reader.result=new ArrayBuffer(8);reader.onload();
  assert.equal((await promise).byteLength,8);assert.equal(progressPercent(events.at(-1)),100);
  const failed=readFileBytes(new File(['a'],'bad.txt'),()=>{});reader.onerror();
  await assert.rejects(failed,/could not be read/);
 }finally{globalThis.FileReader=original;}
});
