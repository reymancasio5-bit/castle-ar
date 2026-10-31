import test from 'node:test';
import assert from 'node:assert/strict';
import {followUpDraft, followUpDirty, buildFollowUpChange, validateFollowUpDraft, isSafeScreenshot} from '../src/follow-ups.ts';
import type {Property} from '../src/types.ts';
const property:Property={id:'p',name:'House',manager:'',totalCents:10000,payments:[]};
const jpeg={name:'Screenshot.jpg',dataUrl:'data:image/jpeg;base64,/9j/AA=='};
test('defaults preserve unassigned manager and independent draft attachments',()=>{
 const draft=followUpDraft(property);assert.equal(draft.status,'not_contacted');assert.equal(draft.manager,'');
 const copy=followUpDraft(property);draft.attachments.push(jpeg);assert.equal(copy.attachments.length,0);
});
test('change includes full explicit state and dirty comparison notices removals',()=>{
 const before=followUpDraft(property);const next={...before,note:'Called owner',attachments:[jpeg]};
 assert.equal(followUpDirty(before,{...before}),false);assert.equal(followUpDirty(before,next),true);
 assert.deepEqual(buildFollowUpChange('p',next),{kind:'updateFollowUp',propertyId:'p',...next});
 assert.equal(followUpDirty(next,{...next,attachments:[]}),true);
});
test('validation rejects unsupported status, formula manager, excessive notes and unsafe screenshots',()=>{
 const draft=followUpDraft(property);
 assert.throws(()=>validateFollowUpDraft({...draft,status:'unknown' as typeof draft.status}),/status/i);
 assert.throws(()=>validateFollowUpDraft({...draft,manager:'=SUM(A1)'}),/manager/i);
 assert.throws(()=>validateFollowUpDraft({...draft,note:'a'.repeat(5001)}),/5,000/);
 assert.throws(()=>validateFollowUpDraft({...draft,attachments:Array.from({length:4},()=>jpeg)}),/three/i);
 assert.equal(isSafeScreenshot(jpeg),true);
 for(const dataUrl of ['https://example.com/image.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/jpeg;base64,not base64','data:image/jpeg;base64,'+'A'.repeat(45000)]) assert.equal(isSafeScreenshot({...jpeg,dataUrl}),false);
 assert.throws(()=>buildFollowUpChange('p',{...draft,attachments:[{...jpeg,dataUrl:'javascript:alert(1)'}]}),/screenshot/i);
});

test('boundary values and persisted state remain unchanged until a validated save',()=>{
 const existing:Property={...property,manager:'Team B',followUp:{status:'payment_promised',note:'Original',attachments:[jpeg],updatedAt:'2026-10-31T00:00:00Z'}};
 const draft=followUpDraft(existing);draft.attachments[0].name='Changed';draft.note='x'.repeat(5000);
 assert.equal(existing.followUp!.attachments[0].name,'Screenshot.jpg');
 assert.equal(existing.followUp!.note,'Original');
 assert.doesNotThrow(()=>validateFollowUpDraft({...draft,manager:'',attachments:[jpeg,jpeg,jpeg]}));
 const change=buildFollowUpChange('p',{...draft,manager:' Team B '});
 assert.equal(change.kind,'updateFollowUp');if(change.kind==='updateFollowUp'){assert.equal(change.manager,'Team B');change.attachments[0].name='Saved copy';}
 assert.equal(draft.attachments[0].name,'Changed');
});
test('source screenshot checks reject bad formats and oversized images before decoding',async()=>{
 const {prepareScreenshot}=await import('../src/follow-ups.ts');
 await assert.rejects(prepareScreenshot(new File(['<svg/>'],'image.svg',{type:'image/svg+xml'})),/PNG, JPEG, or WebP/);
 await assert.rejects(prepareScreenshot(new File([new Uint8Array(10*1024*1024+1)],'large.png',{type:'image/png'})),/10 MB/);
 await assert.rejects(prepareScreenshot(new File([],'empty.png',{type:'image/png'})),/empty/);
});

