import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOwnerChange,matchOwnerDeposits,ownerKey,transferKey} from '../src/owners.ts';
import {createPreviewApi} from '../src/preview-api.ts';
import type {Snapshot,OwnerChange,PropertyOwner} from '../src/types.ts';
import {balance} from '../src/domain.ts';
const owner:PropertyOwner={id:'o',name:'Jane',bankName:'Jane Smith',email:'',notes:'',active:true,propertyNames:[' House ','Other']};
const snapshot=():Snapshot=>({revision:'1',updatedAt:'',spreadsheetUrl:'',owners:[structuredClone(owner)],ownerTransfers:[],months:[{id:'m',label:'Month',month:'2026-09',properties:[{id:'p',name:'House',manager:'',totalCents:10000,payments:[]},{id:'q',name:'Other',manager:'',totalCents:20000,payments:[]}]}]});
const change=():Extract<OwnerChange,{kind:'importOwnerTransfer'}>=>({kind:'importOwnerTransfer',ownerId:'o',monthId:'m',account:'5864',date:'2026-09-09',reference:'CA123456',source:'bank.pdf',bankName:'Jane Smith',amountCents:10000,allocations:[{propertyId:'p',amountCents:10000}]});
const deposit=(reference='CA123456')=>({kind:'owner' as const,ownerName:' Jane   Smith ',account:'5864',date:'2026-09-09',reference,source:'bank.pdf',amountCents:10000});

test('multiple statement names save, match independently and preserve the actual transfer name',()=>{
 const s=snapshot();applyOwnerChange(s,{kind:'saveOwner',owner:{...owner,bankName:'Jane Smith\n JANE   BUSINESS '}});
 assert.equal(s.owners![0].bankName,'Jane Smith\nJANE BUSINESS');
 const row=matchOwnerDeposits([{...deposit(),ownerName:'jane business'}],s.months[0],s.owners!,[])[0];
 assert.equal(row.owner?.id,owner.id);assert.equal(row.allocations.length,1);
 applyOwnerChange(s,{...change(),bankName:'jane business',allocations:row.allocations});
 assert.equal(s.ownerTransfers![0].bankName,'jane business');
 assert.throws(()=>applyOwnerChange(s,{kind:'saveOwner',owner:{...owner,id:'other',bankName:'Other Name\nJane Business'}}),/another owner/);
});
test('invalid and repeated statement aliases are rejected',()=>{
 for(const bankName of ['Jane\njane','Jane\n=unsafe','\n','Jane\n'+'x'.repeat(161)]){
  assert.throws(()=>applyOwnerChange(snapshot(),{kind:'saveOwner',owner:{...owner,bankName}}));
 }
});

test('a unique exact combination splits the deposit and reserves those balances for subsequent deposits',()=>{
 const s=snapshot();
 const rows=matchOwnerDeposits([{...deposit(),amountCents:30000},{...deposit('SECOND'),amountCents:30000}],s.months[0],s.owners!,[]);
 assert.deepEqual(rows[0].allocations,[{propertyId:'p',amountCents:10000},{propertyId:'q',amountCents:20000}]);
 assert.deepEqual(rows[1].allocations,[]);
 applyOwnerChange(s,{...change(),amountCents:30000,allocations:rows[0].allocations});
 assert.deepEqual(s.months[0].properties.map(balance),[0,0]);
});
test('exact subset matching leaves unrelated balances untouched and rejects one-cent mismatches',()=>{
 const s=snapshot();s.owners![0].propertyNames.push('Third');
 s.months[0].properties.push({id:'r',name:'Third',manager:'',totalCents:7000,payments:[]});
 assert.deepEqual(matchOwnerDeposits([{...deposit(),amountCents:27000}],s.months[0],s.owners!,[])[0].allocations,[{propertyId:'q',amountCents:20000},{propertyId:'r',amountCents:7000}]);
 for(const amountCents of [27001,26999,40000])assert.deepEqual(matchOwnerDeposits([{...deposit(),amountCents}],s.months[0],s.owners!,[])[0].allocations,[]);
});
test('a single exact balance competing with an exact split requires manual allocation',()=>{
 const s=snapshot();s.owners![0].propertyNames.push('Third');
 s.months[0].properties.push({id:'r',name:'Third',manager:'',totalCents:30000,payments:[]});
 assert.deepEqual(matchOwnerDeposits([{...deposit(),amountCents:30000}],s.months[0],s.owners!,[])[0].allocations,[]);
});
test('automatic splits respect the selected or explicitly stated reporting month',()=>{
 const s=snapshot();const other={id:'oct',label:'October',month:'2026-10',properties:[{id:'oct:p',name:'House',manager:'',totalCents:7000,payments:[]}]};
 s.months.push(other);
 assert.deepEqual(matchOwnerDeposits([{...deposit(),amountCents:17000}],s.months[0],s.owners!,[],s.months)[0].allocations,[]);
 assert.deepEqual(matchOwnerDeposits([{...deposit(),amountCents:7000,serviceMonth:'2026-10'}],s.months[0],s.owners!,[],s.months)[0].allocations,[{propertyId:'oct:p',amountCents:7000}]);
});

test('owner fee settlement clears 23.11 without verifying the landlord Airbnb payout',()=>{
 const s=snapshot(),p=s.months[0].properties[0];p.totalCents=2311;
 p.payments=[{id:'airbnb',type:'Airbnb',amountCents:null,payoutDate:'',bundleCents:29104,bankDetails:'Checking 4305',bankDate:'',bankCents:null,verifiedByDaisy:false}];
 const before=structuredClone(p.payments[0]);
 const row=matchOwnerDeposits([{...deposit(),account:'7524',amountCents:2311}],s.months[0],s.owners!,[])[0];
 applyOwnerChange(s,{...change(),account:'7524',amountCents:2311,allocations:row.allocations});
 assert.equal(balance(p),0);assert.deepEqual(p.payments[0],before);
});

test('one bulk transfer settles the same property across months with one duplicate identity',()=>{
 const s=snapshot();s.months[0].properties[0].totalCents=2311;
 s.months.push({id:'oct',label:'October',month:'2026-10',properties:[{id:'oct:p',name:'House',manager:'',totalCents:3000,payments:[]}]});
 const c={...change(),amountCents:3311,allocations:[{propertyId:'p',monthId:'m',amountCents:2311},{propertyId:'oct:p',monthId:'oct',amountCents:1000}]};
 applyOwnerChange(s,c);
 assert.equal(balance(s.months[0].properties[0]),0);assert.equal(balance(s.months[1].properties[0]),2000);
 assert.equal(s.ownerTransfers!.length,1);assert.deepEqual(s.ownerTransfers![0].allocations.map(a=>a.monthId),['m','oct']);
 assert.throws(()=>applyOwnerChange(s,c),/already/);
});

test('wrong allocation month is rejected before applying any payment',()=>{
 const s=snapshot(),before=structuredClone(s);
 assert.throws(()=>applyOwnerChange(s,{...change(),allocations:[{propertyId:'p',monthId:'missing',amountCents:10000}]}),/month|mapped/i);
 assert.deepEqual(s,before);
});
test('owner keys normalize whitespace and transfer identity excludes date and amount',()=>{assert.equal(ownerKey(' Jane  Smith '),'jane smith');assert.equal(transferKey('58-64',' ca123456 '),transferKey('5864','CA123456'));});
test('conflicting repeated reference blocks both entries and multiline notes survive profile saves',()=>{const s=snapshot();const rows=matchOwnerDeposits([deposit(),{...deposit(),amountCents:20000}],s.months[0],s.owners!,[]);assert.ok(rows.every(r=>r.duplicate&&r.allocations.length===0));applyOwnerChange(s,{kind:'saveOwner',owner:{...owner,notes:'First line\nSecond line'}});assert.equal(s.owners![0].notes,'First line\nSecond line');});
test('unique exact outstanding matches once; inactive, ambiguous, missing refs and duplicate refs do not auto allocate',()=>{
 const s=snapshot();const rows=matchOwnerDeposits([deposit(),deposit('ZZ987654')],s.months[0],s.owners!,[]);assert.equal(rows[0].allocations.length,1);assert.equal(rows[1].allocations.length,0);
 assert.equal(matchOwnerDeposits([deposit()],s.months[0],[{...owner,active:false}],[])[0].allocations.length,0);
 s.months[0].properties[1].totalCents=10000;assert.equal(matchOwnerDeposits([deposit()],s.months[0],s.owners!,[])[0].allocations.length,0);
 assert.equal(matchOwnerDeposits([deposit('')],s.months[0],s.owners!,[])[0].allocations.length,0);
 assert.equal(matchOwnerDeposits([deposit(),deposit()],s.months[0],s.owners!,[])[1].duplicate,true);
});
test('safe splits create verified Owner rows with no bundle and a persistent dedup ledger',()=>{const s=snapshot(),c=change();c.allocations=[{propertyId:'p',amountCents:4000},{propertyId:'q',amountCents:6000}];applyOwnerChange(s,c);assert.equal(s.ownerTransfers!.length,1);assert.deepEqual(s.months[0].properties.map(p=>[p.payments[0].amountCents,p.payments[0].bankCents,p.payments[0].bundleCents,p.payments[0].type,p.payments[0].verifiedBySystem,p.payments[0].verifiedByDaisy]),[[4000,4000,null,'Owner',true,false],[6000,6000,null,'Owner',true,false]]);assert.throws(()=>applyOwnerChange(s,{...c,amountCents:20000}),/already|duplicate/i);});
test('invalid allocations and malformed profiles never mutate a snapshot',()=>{for(const mutate of [(c:ReturnType<typeof change>)=>c.allocations[0].amountCents=1,(c:ReturnType<typeof change>)=>c.allocations[0].propertyId='missing',(c:ReturnType<typeof change>)=>c.reference='',(c:ReturnType<typeof change>)=>c.date='2026-02-30']){const s=snapshot(),before=structuredClone(s),c=change();mutate(c);assert.throws(()=>applyOwnerChange(s,c));assert.deepEqual(s,before);}const s=snapshot();assert.throws(()=>applyOwnerChange(s,{kind:'saveOwner',owner:{...owner,bankName:'=bad'}}));});
test('preview supports owner schema and rolls back whole failed saves',async()=>{const api=createPreviewApi(),s=await api.read();assert.equal(s.ownerSchema,1);assert.deepEqual(s.owners,[]);await assert.rejects(api.save(s.revision,[{kind:'saveOwner',owner},{...change(),monthId:'missing'}]));assert.deepEqual(await api.read(),s);const saved=await api.save(s.revision,[{kind:'saveOwner',owner}]);assert.deepEqual(saved.owners![0].propertyNames,['House','Other']);});
