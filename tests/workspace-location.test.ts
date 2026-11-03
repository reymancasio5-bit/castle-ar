import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWorkspaceLocation,saveWorkspaceLocation,loadManagerLocation,saveManagerLocation} from '../src/workspace-location.ts';
import type {WorkspaceLocation,ManagerLocation} from '../src/workspace-location.ts';
import {createPreviewApi} from '../src/preview-api.ts';
const defaults:WorkspaceLocation={view:'overview',monthId:'',search:'',manager:'all',status:'all'};
function storage(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};}
test('reload restores current page, month, filters and manager detail section',()=>{
 const store=storage();const location:WorkspaceLocation={view:'managers',monthId:'123',search:'Jarvis',manager:'Team B',status:'outstanding'};
 const manager:ManagerLocation={selectedId:'team-b',search:'Team',tab:'tasks',allMonths:true,taskFilter:'overdue'};
 saveWorkspaceLocation(location,store);saveManagerLocation(manager,store);
 assert.deepEqual(loadWorkspaceLocation(defaults,'',store),location);assert.deepEqual(loadManagerLocation(store),manager);
 assert.equal(loadWorkspaceLocation(defaults,'?view=properties&preview=1',store).view,'properties');
});
test('invalid or blocked navigation storage safely falls back',()=>{
 const broken={getItem:()=>'{bad json',setItem:()=>{throw new Error('blocked');}};
 assert.deepEqual(loadWorkspaceLocation(defaults,'?view=unknown',broken),defaults);assert.doesNotThrow(()=>saveWorkspaceLocation(defaults,broken));
 const store=storage();store.setItem('castle-manager-location-v1',JSON.stringify({tab:'bad',allMonths:'true',taskFilter:42}));
 assert.deepEqual(loadManagerLocation(store),{selectedId:'',search:'',tab:'listings',allMonths:false,taskFilter:'open'});
});

test('sample manager IDs remain stable so a preview reload can restore Team A selection',async()=>{
 const first=await createPreviewApi().read(),second=await createPreviewApi().read();
 assert.equal(first.managers!.find(m=>m.name==='Team A')!.id,second.managers!.find(m=>m.name==='Team A')!.id);
});
