import test from 'node:test';
import assert from 'node:assert/strict';
import {bootstrapManagers, applyManagerChange, resolveManager} from '../src/managers.ts';
import {createPreviewApi} from '../src/preview-api.ts';
import type {Snapshot} from '../src/types.ts';
function fixture():Snapshot { return bootstrapManagers({revision:'r',updatedAt:'',spreadsheetUrl:'',months:[{id:'1',label:'Nov',month:'2026-11',properties:[{id:'p',name:'Listing',manager:' Team  A ',totalCents:100,payments:[]},{id:'q',name:'Other',manager:'team a',totalCents:200,payments:[]}]}]}); }
test('preview deletes an unused manager and protects linked managers',async()=>{
 const api=createPreviewApi();const initial=await api.read();
 await assert.rejects(api.save(initial.revision,[{kind:'deleteManager',managerId:initial.managers![0].id}]),/linked/i);
 const added=await api.save(initial.revision,[{kind:'saveManager',manager:{id:'unused',name:'Unused',email:'',notes:'',active:true}}]);
 const removed=await api.save(added.revision,[{kind:'deleteManager',managerId:'unused'}]);
 assert.ok(!removed.managers!.some(m=>m.id==='unused'));
 assert.deepEqual((await api.read()).managers,removed.managers);
 await assert.rejects(api.save(removed.revision,[{kind:'deleteManager',managerId:'missing'}]),/not found/i);
});

test('bootstrap deduplicates whitespace/case and keeps IDs on rename',()=>{
 const s=fixture();assert.equal(s.managers!.length,1);const manager=s.managers![0];
 applyManagerChange(s,{kind:'saveManager',manager:{...manager,name:'Alice'}});
 assert.equal(s.managers![0].id,manager.id);assert.deepEqual(s.months[0].properties.map(p=>p.manager),['Alice','Alice']);
});
test('unknown names and new inactive assignments are rejected, existing inactive assignment is retained',()=>{
 const s=fixture();const m=s.managers![0];m.active=false;
 assert.throws(()=>resolveManager(s,'typo'),/registered/i);
 assert.throws(()=>resolveManager(s,m.name),/inactive/i);
 assert.equal(resolveManager(s,m.name,m.id)?.id,m.id);
});
test('tasks require real dates, support reassignment and preserve update association',()=>{
 const s=fixture();const id=s.managers![0].id;
 const task={id:'t',managerId:id,title:'Call owner',description:'',dueDate:'2026-02-30',status:'open' as const,propertyKey:''};
 assert.throws(()=>applyManagerChange(s,{kind:'saveTask',task}),/date/i);
 applyManagerChange(s,{kind:'saveTask',task:{...task,dueDate:'2026-11-10'}});
 applyManagerChange(s,{kind:'addManagerUpdate',update:{id:'u',managerId:id,taskId:'t',propertyKey:'',text:'Called'}});
 applyManagerChange(s,{kind:'saveManager',manager:{id:'b',name:'Bob',email:'',notes:'',active:true}});
 applyManagerChange(s,{kind:'saveTask',task:{...s.tasks![0],managerId:'b',status:'completed'}});
 assert.equal(s.tasks![0].managerId,'b');assert.equal(s.managerUpdates![0].managerId,id);
});
test('preview manager and task changes persist across reads and reject stale revisions',async()=>{
 const api=createPreviewApi();const s=await api.read();assert.equal(s.managerSchema,1);
 const next=await api.save(s.revision,[{kind:'saveTask',task:{id:'t',managerId:s.managers![0].id,title:'Review',description:'',dueDate:'2026-11-10',status:'open',propertyKey:''}}]);
 assert.equal((await api.read()).tasks!.length,1);
 await assert.rejects(api.save(s.revision,[]),/changed/i);assert.notEqual(next.revision,s.revision);
});

test('preview assistant role requires a valid parent and protects parent records',()=>{
 const s=fixture();const parent=s.managers![0];const assistant={id:'assistant',name:'Helper',email:'',notes:'',active:true,role:'assistant' as const,parentManagerId:parent.id};
 assert.throws(()=>applyManagerChange(s,{kind:'saveManager',manager:{...assistant,parentManagerId:''}}),/parent/i);
 applyManagerChange(s,{kind:'saveManager',manager:assistant});assert.equal(s.managers![1].parentManagerId,parent.id);
 assert.throws(()=>applyManagerChange(s,{kind:'saveManager',manager:{...parent,role:'assistant',parentManagerId:assistant.id}}),/parent|assistant/i);
 assert.throws(()=>applyManagerChange(s,{kind:'deleteManager',managerId:parent.id}),/assistant|linked/i);
 applyManagerChange(s,{kind:'saveManager',manager:{...assistant,role:'account_manager',parentManagerId:''}});assert.equal(s.managers![1].role,'account_manager');
});
