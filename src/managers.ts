import {defaultManagerProfile,isValidManagerProfile} from './manager-profiles.ts';
import type {AccountManager, ManagerChange, Snapshot} from './types.ts';

export const normalizeManagerName = (name:string) => name.trim().replace(/\s+/g,' ').toLowerCase();
export const listingKey = (monthId:string,name:string) => JSON.stringify([monthId,name.trim().toLowerCase()]);
export function bootstrapManagers(snapshot:Snapshot):Snapshot {
 const next=structuredClone(snapshot);
 next.managerSchema=1;next.managerProfiles=1;next.tasks??=[];next.managerUpdates??=[];
 if(!next.managers){
  next.managers=[];
  for(const p of next.months.flatMap(m=>m.properties)){
   if(!p.manager.trim())continue;
   let manager=next.managers.find(m=>normalizeManagerName(m.name)===normalizeManagerName(p.manager));
   if(!manager){manager={id:'preview-manager-'+encodeURIComponent(normalizeManagerName(p.manager)),name:p.manager.trim().replace(/\s+/g,' '),profileImage:defaultManagerProfile(p.manager),email:'',notes:'',active:true};next.managers.push(manager);}
   p.managerId=manager.id;p.manager=manager.name;
  }
 }
 return next;
}
export function resolveManager(s:Snapshot,name:string,currentId?:string):AccountManager|undefined {
 if(!name)return undefined;
 const m=s.managers?.find(m=>normalizeManagerName(m.name)===normalizeManagerName(name));
 if(!m)throw new Error('Choose a registered account manager.');
 if(!m.active&&m.id!==currentId)throw new Error('This account manager is inactive. Choose an active manager.');
 return m;
}
function text(value:string,label:string,max:number,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new Error(`${label} ${required?'is required and ':''}must be at most ${max} characters.`);return value.trim();}
export function applyManagerChange(s:Snapshot,c:ManagerChange){
 if(s.managerSchema!==1)throw new Error('Update the Apps Script deployment to manage account managers.');
 const managers=s.managers!;
 if(c.kind==='saveManager'){
  const m={...c.manager,name:text(c.manager.name,'Manager name',160,true).replace(/\s+/g,' '),email:text(c.manager.email,'Email',254),notes:text(c.manager.notes,'Notes',5000)};
  if(/^[=+@-]/.test(m.name)||/[\u0000-\u001f\u007f]/.test(m.name))throw new Error('Manager name cannot begin with a formula marker or contain control characters.');
  m.profileImage=c.manager.profileImage??managers.find(old=>old.id===m.id)?.profileImage??'';
  if(!isValidManagerProfile(m.profileImage))throw new Error('Choose a valid profile image (PNG, JPEG, or WebP).');
  text(m.id,'Manager ID',100,true);if(typeof m.active!=='boolean')throw new Error('Manager active status is required.');
  if(m.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email))throw new Error('Enter a valid email address.');
  if(managers.some(x=>x.id!==m.id&&normalizeManagerName(x.name)===normalizeManagerName(m.name)))throw new Error('An account manager with this name already exists.');
  const i=managers.findIndex(x=>x.id===m.id);if(i<0)managers.push(m);else managers[i]=m;
  for(const p of s.months.flatMap(m=>m.properties))if(p.managerId===m.id)p.manager=m.name;
  return;
 }
 const record=c.kind==='saveTask'?c.task:c.update;
 const manager=managers.find(m=>m.id===record.managerId);
 const old=c.kind==='saveTask'?s.tasks!.find(t=>t.id===record.id):undefined;
 if(!manager)throw new Error('Choose a registered account manager.');
 if(!manager.active&&old?.managerId!==manager.id)throw new Error('This account manager is inactive.');
 text(record.id,'Record ID',100,true);
 if(record.propertyKey&&!s.months.some(m=>m.properties.some(p=>listingKey(m.id,p.name)===record.propertyKey)))throw new Error('The linked listing no longer exists.');
 if(c.kind==='saveTask'){
  const t={...c.task,title:text(c.task.title,'Task title',200,true),description:text(c.task.description,'Description',5000),updatedAt:new Date().toISOString()};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate)||!Number.isFinite(Date.parse(t.dueDate))||new Date(t.dueDate).toISOString().slice(0,10)!==t.dueDate)throw new Error('Choose a valid due date.');
  if(!['open','in_progress','completed'].includes(t.status))throw new Error('Choose a valid task status.');
  const i=s.tasks!.findIndex(x=>x.id===t.id);if(i<0)s.tasks!.push(t);else s.tasks![i]=t;
 }else{
  const u={...c.update,text:text(c.update.text,'Update',5000,true),createdAt:new Date().toISOString()};
  if(s.managerUpdates!.some(x=>x.id===u.id))throw new Error('This update already exists.');
  if(u.taskId&&!s.tasks!.some(t=>t.id===u.taskId&&t.managerId===u.managerId))throw new Error('Choose a task assigned to this manager.');
  s.managerUpdates!.push(u);
 }
}
