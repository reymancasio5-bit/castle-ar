import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewApi} from '../src/preview-api.ts';
import {listingCatalog} from '../src/listings.ts';
import {prepareRecordChanges} from '../src/record-save.ts';

test('listings are created without a month or financial amount and reject duplicates',async()=>{
 const api=createPreviewApi(),before=await api.read();
 const listing={id:'new-listing',name:'New House',managerId:before.managers![0].id};
 const after=await api.save(before.revision,[{kind:'saveListing',listing,ownerId:''}]);
 assert.deepEqual(after.months,before.months);
 assert.ok(listingCatalog(after).some(l=>l.id===listing.id));
 await assert.rejects(api.save(after.revision,[{kind:'saveListing',listing:{...listing,id:'duplicate',name:' new   HOUSE '},ownerId:''}]),/already exists/i);
});

test('assignments update all matching months without changing financial data',async()=>{
 const api=createPreviewApi(true),before=await api.read(),listing=listingCatalog(before)[0];
 const manager=before.managers!.find(m=>m.id!==listing.managerId)!;
 const after=await api.save(before.revision,[{kind:'saveListing',listing:{...listing,managerId:manager.id},ownerId:'demo-owner'}]);
 for(const [index,month] of after.months.entries()){
  assert.equal(month.properties[0].managerId,manager.id);
  assert.equal(month.properties[0].totalCents,before.months[index].properties[0].totalCents);
  assert.deepEqual(month.properties[0].payments,before.months[index].properties[0].payments);
 }
 await assert.rejects(api.save(after.revision,[{kind:'saveListing',listing:{...listing,managerId:'missing'},ownerId:''}]),/manager/i);
 await assert.rejects(api.save(after.revision,[{kind:'saveListing',listing,ownerId:'missing'}]),/owner/i);
});

test('concurrent listing assignments require review',async()=>{
 const api=createPreviewApi(),before=await api.read(),listing=listingCatalog(before)[0];
 const latest=structuredClone(before);latest.listings=[{...listing,managerId:'remote'}];
 assert.throws(()=>prepareRecordChanges(before,[{kind:'saveListing',listing:{...listing,managerId:'mine'},ownerId:''}],latest),/Account Manager|Manager Id/);
});

test('listing-only managers are protected and inactive new assignments are rejected',async()=>{
 const api=createPreviewApi(),before=await api.read();
 const manager={id:'only-listing',name:'Directory Manager',active:true,email:'',notes:''};
 const added=await api.save(before.revision,[{kind:'saveManager',manager}]);
 const listing={id:'standalone',name:'Standalone',managerId:manager.id};
 const saved=await api.save(added.revision,[{kind:'saveListing',listing,ownerId:''}]);
 await assert.rejects(api.save(saved.revision,[{kind:'deleteManager',managerId:manager.id}]),/linked/);
 const inactive=await api.save(saved.revision,[{kind:'saveManager',manager:{...manager,active:false}}]);
 await assert.rejects(api.save(inactive.revision,[{kind:'saveListing',listing:{...listing,id:'new',name:'Another'},ownerId:''}]),/active/);
});

test('manager-only listing edits preserve a concurrent owner reassignment',async()=>{
 const api=createPreviewApi(true),before=await api.read(),listing=listingCatalog(before)[0],latest=structuredClone(before);
 latest.owners![0].propertyNames=[];
 latest.owners!.push({...before.owners![0],id:'new-owner',name:'New Owner',bankName:'NEW OWNER'});
 const result=prepareRecordChanges(before,[{kind:'saveListing',listing:{...listing,managerId:before.managers![0].id},ownerId:'demo-owner'}],latest);
 assert.equal(result[0].kind,'saveListing');
 if(result[0].kind==='saveListing')assert.equal(result[0].ownerId,'new-owner');
});
