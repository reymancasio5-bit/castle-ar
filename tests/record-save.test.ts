import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRecordChanges,RecordConflict} from '../src/record-save.ts';
import type {Snapshot,PropertyOwner,Change} from '../src/types.ts';
const owner:PropertyOwner={id:'o',name:'Owner',bankName:'Owner',email:'',notes:'',active:true,propertyNames:['A']};
const snapshot=():Snapshot=>({revision:'old',updatedAt:'',spreadsheetUrl:'',owners:[structuredClone(owner)],managers:[{id:'mgr',name:'Team A',email:'',notes:'',active:true}],tasks:[{id:'task',managerId:'mgr',title:'Task',description:'',dueDate:'2026-12-01',status:'open',propertyKey:''}],months:[{id:'m',month:'2026-10',label:'October',properties:[{id:'m:4',name:'House',manager:'Team A',totalCents:10000,payments:[{id:'m:5',type:'Airbnb',amountCents:1000,payoutDate:'2026-10-01',bundleCents:1000,bankCents:null,bankDate:'',verifiedByDaisy:false}]}]}]});
test('owner saves merge unrelated fields and property assignment additions',()=>{
 const before=snapshot(),latest=snapshot();latest.owners![0].notes='Other user note';latest.owners![0].propertyNames.push('B');
 const result=prepareRecordChanges(before,[{kind:'saveOwner',owner:{...owner,email:'owner@example.com',propertyNames:['A','C']}}],latest);
 assert.equal(result[0].kind,'saveOwner');if(result[0].kind!=='saveOwner')throw Error();
 assert.equal(result[0].owner.notes,'Other user note');assert.deepEqual(result[0].owner.propertyNames,['A','B','C']);assert.equal(result[0].owner.email,'owner@example.com');
});
test('same-field conflicts require explicit resolution, without losing other user fields',()=>{
 const before=snapshot(),latest=snapshot();latest.owners![0].name='Remote';latest.owners![0].notes='Keep';
 const changes:Change[]=[{kind:'saveOwner',owner:{...owner,name:'Local'}}];
 assert.throws(()=>prepareRecordChanges(before,changes,latest),RecordConflict);
 const result=prepareRecordChanges(before,changes,latest,true);if(result[0].kind!=='saveOwner')throw Error();
 assert.equal(result[0].owner.name,'Local');assert.equal(result[0].owner.notes,'Keep');
});
test('manager and task saves preserve concurrent changes to different fields',()=>{
 const before=snapshot(),latest=snapshot();latest.managers![0].email='team@example.com';latest.tasks![0].status='completed';
 const result=prepareRecordChanges(before,[{kind:'saveManager',manager:{...before.managers![0],notes:'Mine'}},{kind:'saveTask',task:{...before.tasks![0],title:'New title'}}],latest);
 assert.equal((result[0] as any).manager.email,'team@example.com');assert.equal((result[1] as any).task.status,'completed');
});
test('property, payment and follow-up saves target shifted rows',()=>{
 const before=snapshot(),latest=snapshot();const p=latest.months[0].properties[0];p.id='m:20';p.payments[0].id='m:21';
 const changes:Change[]=[{kind:'setTotal',propertyId:'m:4',amountCents:20000},{kind:'updatePayment',paymentId:'m:5',fields:{amountCents:1500}},{kind:'updateFollowUp',propertyId:'m:4',manager:'Team A',status:'contact_attempted',note:'Called',attachments:[]}];
 const result=prepareRecordChanges(before,changes,latest);
 assert.equal((result[0] as any).propertyId,'m:20');assert.equal((result[1] as any).paymentId,'m:21');assert.equal((result[2] as any).propertyId,'m:20');
});
test('deleting changed records requires review; renamed targets never fall back to stale row IDs',()=>{
 const before=snapshot(),latest=snapshot();latest.months[0].properties[0].totalCents=20000;
 assert.throws(()=>prepareRecordChanges(before,[{kind:'deleteProperty',propertyId:'m:4'}],latest),RecordConflict);
 latest.months[0].properties[0].name='Different House';
 assert.throws(()=>prepareRecordChanges(before,[{kind:'setTotal',propertyId:'m:4',amountCents:1}],latest,true),/renamed|removed/i);
});
test('new owners save despite unrelated new records and already-applied edits are no-ops',()=>{
 const before=snapshot(),latest=snapshot();latest.owners!.push({...owner,id:'other',bankName:'Another'});
 assert.equal(prepareRecordChanges(before,[{kind:'saveOwner',owner:{...owner,id:'new',bankName:'New'}}],latest).length,1);
 latest.owners![0].notes='Mine';assert.deepEqual(prepareRecordChanges(before,[{kind:'saveOwner',owner:{...owner,notes:'Mine'}}],latest),[]);
});

test('unchanged local payment fields retain remote changes and edits to the same amount conflict',()=>{
 const before=snapshot(),latest=snapshot();latest.months[0].properties[0].payments[0].bankDate='2026-10-02';
 const changes:Change[]=[{kind:'updatePayment',paymentId:'m:5',fields:{amountCents:1500,bankDate:''}}];
 const result=prepareRecordChanges(before,changes,latest);assert.deepEqual((result[0] as any).fields,{amountCents:1500});
 latest.months[0].properties[0].payments[0].amountCents=2000;
 assert.throws(()=>prepareRecordChanges(before,changes,latest),RecordConflict);
});
test('deleting one of identical payments cannot redirect a stale edit to the remaining payment',()=>{
 const before=snapshot();before.months[0].properties[0].payments.push({...before.months[0].properties[0].payments[0],id:'m:6'});
 const latest=structuredClone(before);latest.months[0].properties[0].payments.pop();
 assert.throws(()=>prepareRecordChanges(before,[{kind:'deletePayment',paymentId:'m:6'}],latest),/cannot be identified safely/);
});
test('follow-up notes and manager assignments merge independently',()=>{
 const before=snapshot(),latest=snapshot();latest.months[0].properties[0].manager='Team B';
 const result=prepareRecordChanges(before,[{kind:'updateFollowUp',propertyId:'m:4',manager:'Team A',status:'contact_attempted',note:'Called',attachments:[]}],latest);
 assert.equal((result[0] as any).manager,'Team B');assert.equal((result[0] as any).note,'Called');
});
test('new properties and manager updates survive unrelated changes, and manager deletion checks its own record',()=>{
 const before=snapshot(),latest=snapshot();latest.revision='new';latest.months[0].properties[0].totalCents=1;
 const changes:Change[]=[{kind:'addProperty',monthId:'m',name:'New House',manager:'Team A',totalCents:0},{kind:'addManagerUpdate',update:{id:'update',managerId:'mgr',text:'Progress',taskId:'',propertyKey:''}},{kind:'deleteManager',managerId:'mgr'}];
 assert.deepEqual(prepareRecordChanges(before,changes,latest),changes);
 latest.managers![0].notes='Changed';assert.throws(()=>prepareRecordChanges(before,[changes[2]],latest),RecordConflict);
});
