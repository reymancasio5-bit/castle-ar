import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, validateEndpoint } from '../src/api.ts';
import { sampleSnapshot } from '../src/sample.ts';
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
 await assert.rejects(api.save('old',[]),/Sheet changed/);
});
test('an opaque submitted POST without acknowledgement never counts as saved',async()=>{
 const api=createApi('https://script.google.com/macros/s/A/exec',{post:()=>()=>{},get:async()=>({ok:true,pending:true}),pause:async()=>{}});
 await assert.rejects(api.save('old',[]),/not confirmed/);
});
