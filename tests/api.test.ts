import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, validateEndpoint } from '../src/api.ts';
import { sampleSnapshot } from '../src/sample.ts';
import {getProgress,subscribeProgress,progressPercent} from '../src/operation-progress.ts';

test('assistant attachment stays in progress until the server confirms completion',async()=>{
 const states:any[]=[];let calls=0;
 const unsubscribe=subscribeProgress(()=>states.push(...getProgress().filter(p=>p.title.includes('receipt.txt'))));
 try{
  const api=createApi('https://script.google.com/macros/s/A/exec',{post:()=>()=>{},get:async()=>++calls===1?{ok:true,pending:true,progress:'Reading attachment'}:{ok:true,assistant:{text:'Read successfully'}},pause:async()=>{}});
  await api.assistant({message:'Review',monthId:'0',history:[],attachment:{id:'file-1',name:'receipt.txt',kind:'document',text:'Example'}});
  assert.ok(states.some(p=>p.state==='working'&&p.label==='Reading attachment'));
  assert.ok(states.filter(p=>p.state==='working').every(p=>progressPercent(p)===undefined));
  assert.equal(states.at(-1)?.state,'complete');
 }finally{unsubscribe();}
});

test('assistant attachment failure is not presented as a completed upload',async()=>{
 const api=createApi('https://script.google.com/macros/s/A/exec',{post:()=>()=>{},get:async()=>({ok:false,error:{code:'FAILED',message:'Server unavailable'}}),pause:async()=>{}});
 await assert.rejects(api.assistant({message:'Review',monthId:'0',history:[],attachment:{id:'file-2',name:'failed.txt',kind:'document',text:'Example'}}),/Server unavailable/);
 const state=getProgress().find(p=>p.title.includes('failed.txt'));
 assert.equal(state?.state,'error');
 assert.equal(state&&progressPercent(state),undefined);
});

test('assistant sends no credentials and polls an opaque receipt',async()=>{
 let body:any,cleaned=false;const queries:Record<string,string>[]=[];
 const api=createApi('https://script.google.com/macros/s/A/exec',{post:p=>{body=p;return ()=>{cleaned=true;}},get:async p=>{queries.push(p);return {ok:true,assistant:{text:'Report'}};},pause:async()=>{}});
 assert.equal((await api.assistant({message:'Payment report',monthId:'0',history:[]})).text,'Report');
 assert.equal(body.operation,'assistant');assert.equal('passcode' in body,false);assert.equal(JSON.stringify(queries).includes('private-passcode'),false);assert.equal(cleaned,true);
});
test('only deployed Google Apps Script endpoints are accepted',()=>{
 assert.equal(validateEndpoint('https://script.google.com/macros/s/ABC123/exec'),'https://script.google.com/macros/s/ABC123/exec');
 for(const u of ['javascript:alert(1)','https://example.com/exec','https://script.google.com/macros/s/A/dev']) assert.throws(()=>validateEndpoint(u));
});
test('save awaits server acknowledgement and returns authoritative snapshot',async()=>{
 let calls=0; let body:any;
 const confirmed={...sampleSnapshot,revision:'after-save'};
 const api=createApi('https://script.google.com/macros/s/A/exec',{post: p=>{body=p;return ()=>{}},get:async()=>++calls===1?{ok:true,pending:true}:{ok:true,snapshot:confirmed},pause:async()=>{}});
 const result=await api.save('before-save',[{kind:'setTotal',propertyId:'0:4',amountCents:0}]);
 assert.equal(result.revision,'after-save'); assert.equal(body.revision,'before-save'); assert.equal(body.changes[0].amountCents,0); assert.equal(calls,2);
});
test('server conflict is not reported as a successful save',async()=>{
 const api=createApi('https://script.google.com/macros/s/A/exec',{post:()=>()=>{},get:async()=>({ok:false,error:{code:'CONFLICT',message:'Sheet changed. Refresh and retry.'}}),pause:async()=>{}});
 await assert.rejects(api.save('old',[]),(error:any)=>error.code==='CONFLICT'&&/Sheet changed/.test(error.message));
});
test('an opaque submitted POST without acknowledgement never counts as saved',async()=>{
 const api=createApi('https://script.google.com/macros/s/A/exec',{post:()=>()=>{},get:async()=>({ok:true,pending:true}),pause:async()=>{}});
 await assert.rejects(api.save('old',[]),/not confirmed/);
});

test('save reports measured server steps and completes only after confirmation',async()=>{
 const progress:any[]=[];let calls=0;
 const api=createApi('https://script.google.com/macros/s/A/exec',{post:()=>()=>{},get:async()=>++calls===1?{ok:true,pending:true,saveProgress:{completed:1,total:3,label:'Saving Records'}}:{ok:true,snapshot:sampleSnapshot},pause:async()=>{}});
 await api.save('old',[],p=>progress.push(p));
 assert.equal(progress[0].total,undefined);
 assert.equal(progress[1].completed,1);
 assert.equal(progress[1].total,3);
 assert.equal(progress.at(-1).completed,3);
});

test('save without server measurements never fabricates a percentage on failure',async()=>{
 const progress:any[]=[];
 const api=createApi('https://script.google.com/macros/s/A/exec',{post:()=>()=>{},get:async()=>({ok:true,pending:true}),pause:async()=>{}});
 await assert.rejects(api.save('old',[],p=>progress.push(p)),/not confirmed/);
 assert.ok(progress.length>0);
 assert.ok(progress.every(p=>p.total===undefined));
});
