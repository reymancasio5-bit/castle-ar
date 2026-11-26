import {buildBulkImportPreview,type BulkImportEntry} from './bulk-import.ts';
import {normalizePropertyName} from './import.ts';
import {isAirbnbSheet} from './property-import.ts';
import {balance,parseMoney} from './domain.ts';
import type {Change,Month,Payment,Property,Snapshot} from './types.ts';
import {ownerBankNames,ownerKey,ownerTransferAllocated,ownerTransferOperationApplied} from './owners.ts';
import {compatibleAccountIdentity,payoutAccount,sameBankReference,snapshotAccountDirectory,validSourceAccount} from './bank-account.ts';
import {runProgress,type ReportProgress} from './operation-progress.ts';

export class ImportReviewRequired extends Error {
  month:Month;
  constructor(message:string,month:Month){super(message+' Your files and choices are kept. Review the updated preview, then confirm again.');this.name='ImportReviewRequired';this.month=month;}
}
type ImportApi={read:()=>Promise<Snapshot>;save:(revision:string,changes:Change[],onProgress?:ReportProgress)=>Promise<Snapshot>};
/** Only retry server replies that guarantee the attempted write was rejected. */
export async function saveRebuiltImport(api:ImportApi,prepare:(latest:Snapshot)=>Change[]|Promise<Change[]>,pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms)),busyMessage='Other users are still saving. Your files and choices are kept; click Confirm Import again in a moment.',onProgress?:ReportProgress):Promise<Snapshot>{
 return runProgress('Saving Records',async report=>{
  for(let attempt=0;attempt<4;attempt++){
    report({label:attempt?'Refreshing Records Before Retry':'Checking Latest Records'});
    const latest=await api.read();
    report({label:'Validating Changes'});
    const changes=await prepare(latest);
    if(!changes.length)return latest;
    try{return await api.save(latest.revision,changes,report);}
    catch(error){
      const code=(error as {code?:string})?.code;
      if(code!=='CONFLICT'&&code!=='BUSY')throw error;
      if(attempt===3)throw new Error(busyMessage);
      await pause(200*(attempt+1)+Math.floor(Math.random()*150));
    }
  }
  throw new Error('Import could not be saved.');
 },onProgress);
}
const signature=(payment:Payment)=>JSON.stringify(Object.entries(payment).filter(([key])=>key!=='id').sort(([a],[b])=>a.localeCompare(b)));
const emptyPayment=(p:Payment)=>p.amountCents===null&&p.bundleCents===null&&!p.payoutDate&&!p.bankDetails&&p.bankCents===null&&!p.bankDate&&!p.verifiedBySystem&&!p.verifiedByDaisy;

/** Reparse retained source files against current row IDs; never replay stale mutations. */
export function prepareFreshBulkImport(original:Month,entries:BulkImportEntry[],reviewed:Change[],latest:Snapshot):Change[]{
  const month=latest.months.find(m=>m.id===original.id);
  if(!month)throw new Error('The selected month is no longer available. Your files are kept; choose the correct month before importing.');
  const fail=(message:string):never=>{throw new ImportReviewRequired(message,month);};
  for(const entry of entries){
    const bundleOnly=!entry.options.targetAr&&isAirbnbSheet(entry.sheet,entry.options.headerRow)&&(parseMoney(entry.options.total)??0)===0;
    const matches=(m:Month)=>m.properties.filter(p=>!!p.bundleOnly===bundleOnly&&normalizePropertyName(p.name)===normalizePropertyName(entry.options.propertyName));
    const before=matches(original),now=matches(month);
    if(before.length&& !now.length)fail('This property was renamed or removed by another user.');
    if(now.length>1)fail('More than one property now matches this name.');
    const desired=bundleOnly?0:parseMoney(entry.options.total);
    if(now[0]&&now[0].totalCents!==desired&&(!before[0]||now[0].totalCents!==before[0].totalCents))fail('Another user changed this property’s expected amount.');
    if(!before.length&&now[0]&&normalizePropertyName(now[0].manager)!==normalizePropertyName(entry.options.manager))fail('Another user created this property under a different manager.');
  }
  let changes:Change[];
  try{changes=buildBulkImportPreview(month,entries).changes;}
  catch(error){return fail(error instanceof Error?error.message:'The latest records need review.');}
  const approved=reviewed.flatMap(change=>change.kind==='updatePayment'?original.properties.flatMap(p=>p.payments).filter(p=>p.id===change.paymentId):[]).map(signature);
  const auto=entries.every(entry=>isAirbnbSheet(entry.sheet,entry.options.headerRow)&&(entries.length>1||entry.options.airbnbSlot==='auto'));
  for(const change of changes){
    if(change.kind!=='updatePayment')continue;
    const payment=month.properties.flatMap(p=>p.payments).find(p=>p.id===change.paymentId);
    if(!payment||(!approved.includes(signature(payment))&&!(auto&&emptyPayment(payment))))fail('A payment this import would replace has changed.');
  }
  return changes;
}

export class BankImportReviewRequired extends Error {
  snapshot:Snapshot;
  constructor(snapshot:Snapshot){super('Records used by this bank import changed. Your files are kept and the latest records are shown. Review the allocations, then save again.');this.name='BankImportReviewRequired';this.snapshot=snapshot;}
}
function findFreshProperty(original:Snapshot,latest:Snapshot,id:string):{before:Property;after:Property;monthId:string}|undefined{
  const month=original.months.find(m=>m.properties.some(p=>p.id===id)),before=month?.properties.find(p=>p.id===id);
  if(!month||!before)return;
  const matches=latest.months.find(m=>m.id===month.id)?.properties.filter(p=>!!p.bundleOnly===!!before.bundleOnly&&normalizePropertyName(p.name)===normalizePropertyName(before.name))??[];
  if(matches.length!==1)return;
  return {before,after:matches[0],monthId:month.id};
}
const financialSignature=(p:Property)=>JSON.stringify([p.totalCents,p.payments.map(signature)]);
function ownerAllocationContext(snapshot:Snapshot,ownerId:string):string{
 const owner=snapshot.owners?.find(o=>o.id===ownerId);
 if(!owner)return '';
 const mapped=new Set(owner.propertyNames.map(ownerKey));
 const balances=snapshot.months.flatMap(m=>m.properties.filter(p=>!p.bundleOnly&&mapped.has(ownerKey(p.name)))
  .map(p=>JSON.stringify([m.id,m.month,ownerKey(p.name),balance(p)]))).sort();
 return JSON.stringify([owner.active,ownerBankNames(owner.bankName).map(ownerKey).sort(),[...mapped].sort(),balances]);
}
export function prepareFreshBankImport(original:Snapshot,changes:Change[],latest:Snapshot):Change[]{
  if(latest.bankReceiptSchema!==1||!Array.isArray(latest.bankReceipts)||original.bankReceiptSchema!==1||!Array.isArray(original.bankReceipts))throw new Error('Deploy the updated bank receipt backend before importing statements.');
  const sources=changes.flatMap<{account:string;accountIdentity?:string;currency?:string}>(c=>c.kind==='reconcileBank'?[{account:c.account,...c.receipt}]:c.kind==='importOwnerTransfer'?[c]:[]);
  if(sources.some(c=>c.accountIdentity?.length===4)&&(latest.bankAccountSuffixSchema!==1||original.bankAccountSuffixSchema!==1))throw new Error('Deploy the updated Apps Script backend before importing accounts using the last four digits.');
  const directory=snapshotAccountDirectory(latest,sources);
  const fail=():never=>{throw new BankImportReviewRequired(latest);};
  if(sources.some(c=>directory.ambiguous(c.account,c.accountIdentity)))return fail();
  const bankContext=(snapshot:Snapshot,accounts:Set<string>)=>JSON.stringify([
    snapshot.bankReceipts?.filter(r=>accounts.has(r.account)),snapshot.ownerTransfers?.filter(r=>accounts.has(r.account)),
    snapshot.months.flatMap(m=>m.properties.flatMap(p=>p.payments.flatMap(row=>accounts.has(payoutAccount(row.bankDetails).suffix)?[[m.id,p.name,!!p.bundleOnly,signature(row)]]:[])))
  ]);
  const accounts=new Set(changes.flatMap(c=>c.kind==='reconcileBank'?[c.account]:[]));
  if(accounts.size&&bankContext(original,accounts)!==bankContext(latest,accounts))return fail();
  const results:Change[]=[],reviewedOwners=new Set<string>();
  for(const change of changes){
    if(change.kind==='reconcileBank'){
      if(!change.receipt||!validSourceAccount(change.account,change.receipt.accountIdentity)||!change.receipt.reference.trim()||!change.receipt.currency)return fail();
      const before=original.months.flatMap(m=>m.properties).find(p=>p.payments.some(row=>row.id===change.paymentId));
      const target=before&&findFreshProperty(original,latest,before.id);
      if(!target||financialSignature(target.before)!==financialSignature(target.after))return fail();
      const index=target.before.payments.findIndex(p=>p.id===change.paymentId);
      results.push({...change,paymentId:target.after.payments[index].id});
    }else if(change.kind==='importOwnerTransfer'){
      const targets=change.allocations.map(a=>({allocation:a,target:findFreshProperty(original,latest,a.propertyId)}));
      if(targets.some(t=>!t.target||t.allocation.monthId!==undefined&&t.allocation.monthId!==t.target.monthId))return fail();
      if(!validSourceAccount(change.account,change.accountIdentity)||!change.currency||latest.bankReceipts.some(r=>sameBankReference(r,change)))return fail();
      const applyNow=change.allocations.reduce((sum,a)=>sum+a.amountCents,0);
      if((change.transferId||applyNow<change.amountCents)&&(latest.ownerReceiptSchema!==1||original.ownerReceiptSchema!==1))throw new Error('Deploy the updated Apps Script backend before saving partial owner allocations.');
      if(change.priorAllocatedCents!==undefined&&!change.transferId)return fail();
      const aliases=latest.ownerTransfers?.filter(t=>sameBankReference(t,change))??[],duplicate=aliases[0];
      if(aliases.length>1||aliases.some(t=>directory.ambiguous(t.account,t.accountIdentity)))return fail();
      const base=change.transferId?change.priorAllocatedCents:0;
      if(base===undefined||!Number.isSafeInteger(base)||base<0)return fail();
      if(change.transferId){
        const before=original.ownerTransfers?.find(t=>t.id===change.transferId);
        if(!before||!sameBankReference(before,change)||ownerTransferAllocated(before)!==base||duplicate?.id!==change.transferId)return fail();
      }
      if(duplicate){
        const expected=targets.map(({allocation,target})=>({propertyName:target!.before.name,monthId:target!.monthId,amountCents:allocation.amountCents}));
        if(!compatibleAccountIdentity(duplicate.accountIdentity,change.accountIdentity)||duplicate.currency!==change.currency||duplicate.ownerId!==change.ownerId||ownerKey(duplicate.bankName)!==ownerKey(change.bankName)||duplicate.date!==change.date||duplicate.amountCents!==change.amountCents)return fail();
        if(ownerTransferOperationApplied(duplicate,base,expected))continue;
        if(!change.transferId||ownerTransferAllocated(duplicate)!==base)return fail();
      }
      if(!Number.isSafeInteger(applyNow)||applyNow<=0||applyNow>change.amountCents-base)return fail();
      if(!reviewedOwners.has(change.ownerId)){
        if(ownerAllocationContext(original,change.ownerId)!==ownerAllocationContext(latest,change.ownerId))return fail();
        reviewedOwners.add(change.ownerId);
      }
      if(targets.some(({target})=>financialSignature(target!.before)!==financialSignature(target!.after)))return fail();
      results.push({...change,allocations:targets.map(({allocation,target})=>({...allocation,propertyId:target!.after.id}))});
    }else throw new Error('Unsupported bank import change.');
  }
  return results;
}
/** Preserve entered allocation amounts when unrelated row insertions move properties. */
export function remapBankAllocationDrafts(original:Snapshot,latest:Snapshot,drafts:Record<number,Record<string,string>>):Record<number,Record<string,string>>{
  return Object.fromEntries(Object.entries(drafts).map(([index,values])=>[index,Object.fromEntries(Object.entries(values).flatMap(([id,value])=>{const target=findFreshProperty(original,latest,id);return target?[[target.after.id,value]]:[];}))]));
}
