import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewApi} from '../src/preview-api.ts';

test('follow-up saves share manager, notes, images and status without changing payments', async()=>{
 const api=createPreviewApi();const before=await api.read();const property=before.months[0].properties[0];
 const attachments=[{name:'Conversation.png',dataUrl:'data:image/png;base64,iVBORw0KGgo='}];
 const saved=await api.save(before.revision,[{kind:'updateFollowUp',propertyId:property.id,manager:'Team C',status:'owner_responded',note:'Owner asked about the balance.',attachments}]);
 const after=saved.months[0].properties[0];
 assert.equal(after.manager,'Team C');assert.equal(after.followUp?.status,'owner_responded');
 assert.equal(after.followUp?.note,'Owner asked about the balance.');assert.deepEqual(after.followUp?.attachments,attachments);
 assert.ok(after.followUp?.updatedAt);assert.deepEqual(after.payments,property.payments);assert.equal(after.totalCents,property.totalCents);
 attachments[0].name='Changed locally';assert.equal((await api.read()).months[0].properties[0].followUp?.attachments[0].name,'Conversation.png');
 await assert.rejects(api.save(before.revision,[{kind:'updateFollowUp',propertyId:property.id,manager:'',status:'resolved',note:'',attachments:[]}]),/changed/i);
});

test('invalid follow-up updates cannot partially change preview data', async()=>{
 const api=createPreviewApi();const before=await api.read();const id=before.months[0].properties[0].id;
 await assert.rejects(api.save(before.revision,[{kind:'setTotal',propertyId:id,amountCents:1},{kind:'updateFollowUp',propertyId:id,manager:'Team',status:'resolved',note:'x'.repeat(5001),attachments:[]}]),/5,000/);
 assert.deepEqual(await api.read(),before);
});
