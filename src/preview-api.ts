import {bootstrapManagers, applyManagerChange, resolveManager} from './managers.ts';
import { sampleSnapshot } from './sample.ts';
import type { Change, Payment, Snapshot } from './types.ts';
import { validateFollowUpDraft } from './follow-ups.ts';
import {applyOwnerChange} from './owners.ts';
export function createPreviewApi(ownerDemo=false) {
 let state:Snapshot=bootstrapManagers(sampleSnapshot);state.bundleMatchingSchema=1;state.bankStatementSchema=2;state.recordEditingSchema=1;
 state.airbnbRecipientSchema=1;state.ownerAllocationSchema=1;state.ownerSchema=1;state.ownerBankNamesSchema=1;state.owners=[];state.ownerTransfers=[];
 if(ownerDemo){
  const propertyName='Mtl 404 Le Bijou';
  state.owners=[{id:'demo-owner',name:'Bijou Demo Owner',bankName:'BIJOU DEMO OWNER',email:'',notes:'Fictional owner for testing statement allocation.',active:true,propertyNames:[propertyName]}];
  state.months=[['2026-11','Nov, 2026',2311],['2026-10','Oct, 2026',3000],['2026-09','Sep, 2026',4000]].map(([month,label,total])=>({id:String(month),month:String(month),label:String(label),properties:[{id:String(month)+':bijou',name:propertyName,manager:'Team B',totalCents:Number(total),payments:[]}]}));
 }
 // Fictional, editable examples belong only to the isolated preview.
 for(const [team,name,id] of [['Team A','Alex Chen','preview-assistant-alex'],['Team B','Maya Cruz','preview-assistant-maya']]){
  const parent=state.managers!.find(manager=>manager.name.replace(/\s/g,'').toLowerCase()===team.replace(/\s/g,'').toLowerCase());
  if(parent)state.managers!.push({id,name,email:id==='preview-assistant-alex'?'alex@example.com':'maya@example.com',notes:'Sample assistant. Try editing the role, selecting another Account Manager, or adding a task.',active:true,profileImage:'',role:'assistant',parentManagerId:parent.id});
 }
 return {read:async()=>structuredClone(state), save:async(revision:string, changes:Change[])=>{
  if(revision!==state.revision)throw new Error('Preview changed. Refresh and try again.');
  if(changes.some(c=>c.kind==='deleteProperty'||c.kind==='deletePayment')&&changes.length!==1)throw new Error('Save edits before deleting a record.');
  const next=structuredClone(state);
  for(const c of changes) {
   if(c.kind==='saveOwner'||c.kind==='importOwnerTransfer'){applyOwnerChange(next,c);continue;}
   if(c.kind==='deleteManager'||c.kind==='saveManager'||c.kind==='saveTask'||c.kind==='addManagerUpdate'){applyManagerChange(next,c);continue;}
   if(c.kind==='updateProperty'||c.kind==='deleteProperty'||c.kind==='deletePayment'){
    if(c.kind==='deletePayment'){
     const owner=next.months.flatMap(m=>m.properties).find(p=>p.payments.some(row=>row.id===c.paymentId));if(!owner)throw new Error('Payment not found.');owner.payments=owner.payments.filter(p=>p.id!==c.paymentId);continue;
    }
    const month=next.months.find(m=>m.properties.some(p=>p.id===c.propertyId)),p=month?.properties.find(p=>p.id===c.propertyId);if(!month||!p)throw new Error('Property not found.');
    const oldKey=JSON.stringify([month.id,p.name.trim().toLowerCase()]);let newKey='';
    if(c.kind==='deleteProperty')month.properties=month.properties.filter(row=>row.id!==p.id);
    else{
     const name=c.name.trim();if(!name||name.length>160||/^[=+@-]/.test(name)||/[\u0000-\u001f\u007f]/.test(name))throw new Error('Enter a valid property name.');
     if(month.properties.some(row=>row.id!==p.id&&!!row.bundleOnly===!!p.bundleOnly&&row.name.toLowerCase()===name.toLowerCase()))throw new Error('This property name already exists.');
     const manager=resolveManager(next,c.manager,p.managerId);p.name=name;p.manager=manager?.name??'';p.managerId=manager?.id;newKey=JSON.stringify([month.id,name.toLowerCase()]);
    }
    for(const row of [...(next.tasks??[]),...(next.managerUpdates??[])])if(!p.bundleOnly&&row.propertyKey===oldKey)row.propertyKey=newKey;
    continue;
   }
   if(c.kind==='addProperty') {
    const manager=resolveManager(next,c.manager);if(!manager)throw new Error('Choose a registered account manager.');
    const month=next.months.find(m=>m.id===c.monthId);if(!month)throw new Error('Month not found.');
    const id='preview-'+crypto.randomUUID();
    const payments: Payment[] = [];
    for (const { index, ...fields } of [...(c.initialPayments ?? [])].sort((a,b)=>(a.index===4?-1:a.index)-(b.index===4?-1:b.index))) {
     payments.push({id:id+':'+index,type:index===4?'Owner':index===3?'Vrbo':'Airbnb',payoutDate:'',bundleCents:null,bankDate:'',bankCents:null,verifiedByDaisy:false,...fields});
    }
    month.properties.push({id,name:c.name,manager:manager.name,managerId:manager.id,totalCents:c.totalCents,...(c.bundleOnly?{bundleOnly:true}:{}),payments});
    for (const fields of c.additionalPayments ?? []) month.properties[month.properties.length - 1].payments.push({id:crypto.randomUUID(),type:'Airbnb',payoutDate:'',bundleCents:null,bankDate:'',bankCents:null,verifiedByDaisy:false,...fields});
   } else {
    const properties=next.months.flatMap(m=>m.properties);
    if(c.kind==='setTotal'){const p=properties.find(p=>p.id===c.propertyId);if(!p)throw new Error('Property not found.');p.totalCents=c.amountCents;}
    else if(c.kind==='updateFollowUp') {
     validateFollowUpDraft(c);
     const p=properties.find(p=>p.id===c.propertyId);if(!p)throw new Error('Property not found.');
     const manager=resolveManager(next,c.manager,p.managerId);p.manager=manager?.name??'';p.managerId=manager?.id;p.followUp={status:c.status,note:c.note,attachments:structuredClone(c.attachments),updatedAt:new Date().toISOString()};
    }
    else if(c.kind==='appendPayments'){const p=properties.find(p=>p.id===c.propertyId);if(!p)throw new Error('Property not found.');for(const fields of c.payments)p.payments.push({id:crypto.randomUUID(),type:'Airbnb',payoutDate:'',bundleCents:null,bankDate:'',bankCents:null,verifiedByDaisy:false,...fields});}
    else if(c.kind==='reconcileBank'){const p=properties.flatMap(p=>p.payments).find(p=>p.id===c.paymentId);if(!p||p.receivedBy==='owner'||p.bundleCents!==c.bundleCents)throw new Error('Bundle changed.');p.bankCents=p.amountCents;p.bankDate=c.bankDate;p.verifiedBySystem=true;}
    else {const p=properties.flatMap(p=>p.payments).find(p=>p.id===c.paymentId);if(!p)throw new Error('Payment not found.');if((c.fields.receivedBy??p.receivedBy)==='owner'&&(c.fields.type??p.type)!=='Airbnb')throw new Error('Only Airbnb payouts can be received by an owner.');const evidenceChanged=Object.entries(c.fields).some(([key,value])=>key!=='verifiedByDaisy'&&p[key as keyof Payment]!==value);Object.assign(p,c.fields);if(evidenceChanged)p.verifiedBySystem=false}
   }
  }
  next.revision='preview-'+crypto.randomUUID();next.updatedAt=new Date().toISOString();state=next;return structuredClone(state);
 }};
}
