import { parseMoney } from './domain.ts';
import { normalizePropertyName, MAX_IMPORT_ROWS } from './import.ts';
import type { ImportSheet } from './import.ts';
import { buildPropertyImportPreview, isAirbnbSheet } from './property-import.ts';
import type { PropertyImportOptions, PropertyPreviewRow } from './property-import.ts';
import type { Change, ImportedPayment, Month, Payment, Property } from './types.ts';

export interface BulkImportEntry { fileName: string; sheet: ImportSheet; options: PropertyImportOptions }
export interface BulkImportPreview { rows: (PropertyPreviewRow & {fileName: string; fileIndex: number})[]; changes: Change[]; readyCount: number; skippedCount: number; invalidCount: number; unmatchedCount: number }
const paymentFields = (p: Payment): ImportedPayment => ({...(p.bankDetails ? {bankDetails:p.bankDetails} : {}),amountCents:p.amountCents!, ...(p.payoutDate ? {payoutDate:p.payoutDate} : {}), ...(p.bundleCents !== null ? {bundleCents:p.bundleCents} : {})});
const blank = (id: string, type: Payment['type'] = 'Airbnb'): Payment => ({id,type,amountCents:null,payoutDate:'',bundleCents:null,bankDate:'',bankCents:null,verifiedByDaisy:false});
export function buildBulkImportPreview(month: Month, entries: BulkImportEntry[]): BulkImportPreview {
 if(entries.length > 50) throw new Error('Import at most 50 files at a time.');
 if(new Set(entries.map(entry=>normalizePropertyName(entry.options.propertyName))).size>1) throw new Error('Choose one property for the entire bulk import.');
 if(entries.reduce((n,e)=>n+e.sheet.rows.length,0)>MAX_IMPORT_ROWS) throw new Error('Combined import exceeds 10,000 rows.');
 const simulated = structuredClone(month);
 const rows: BulkImportPreview['rows'] = [];
 const selections = new Map<string, {total:number | null; manager:string}>();
 const currencies = new Set<string>();
 entries.forEach(({fileName,sheet,options},fileIndex)=>{
  try {
   if(sheet.error) throw new Error(sheet.error);
   const airbnb = isAirbnbSheet(sheet,options.headerRow);
   if(entries.length>1 && !airbnb) throw new Error('Multi-file import requires recognized Airbnb payout exports. Provide a sample for Vrbo, Booking, or unknown formats; use manual mapping for a single file.');
   const key = normalizePropertyName(options.propertyName);
   const selection = {total:airbnb ? (parseMoney(options.total) ?? 0) : parseMoney(options.total),manager:options.manager.trim()};
   const previous = selections.get(key);
   if(previous && previous.total !== selection.total) throw new Error('Conflicting manual Total Payment for the same property.');
   if(previous && previous.manager !== selection.manager) throw new Error('Conflicting manager for the same property.');
   selections.set(key,selection);
   if(airbnb) {
    const currencyColumn = sheet.rows[options.headerRow!].findIndex(c=>String(c.value??'').trim().toLowerCase()==='currency');
    for(const cells of sheet.rows.slice(options.headerRow!+1)) {
     const currency=String(cells[currencyColumn]?.value??'').trim().toUpperCase();
     if(currency) currencies.add(currency);
    }
    if(currencies.size>1) throw new Error('Import one currency at a time across all files.');
   }
   const preview=buildPropertyImportPreview(simulated,sheet,{...options,...(entries.length>1 ? {airbnbSlot:'auto' as const} : {})});
   if(preview.invalidCount || preview.unmatchedCount) throw new Error(preview.rows.find(r=>r.status==='invalid'||r.status==='unmatched')?.reason || 'Invalid import rows.');
   rows.push(...preview.rows.map(row=>({...row,fileName,fileIndex})));
   for(const change of preview.changes) {
    if(change.kind==='addProperty') {
     const id=`bulk-new-${fileIndex}`;
     const property: Property = {id,name:change.name,manager:change.manager,totalCents:change.totalCents,...(change.bundleOnly?{bundleOnly:true}:{}),payments:(['Airbnb','Airbnb','Airbnb','Vrbo','Owner'] as const).map((type,i)=>blank(`${id}-${i}`,type))};
     for(const {index,...fields} of change.initialPayments??[]) Object.assign(property.payments[index],fields);
     for(const fields of change.additionalPayments??[]) property.payments.push({...blank(`${id}-${property.payments.length}`),...fields});
     simulated.properties.push(property);
    } else if(change.kind==='setTotal') simulated.properties.find(p=>p.id===change.propertyId)!.totalCents=change.amountCents;
    else if(change.kind==='updatePayment') Object.assign(simulated.properties.flatMap(p=>p.payments).find(p=>p.id===change.paymentId)!,change.fields);
    else if(change.kind==='appendPayments') {
     const property=simulated.properties.find(p=>p.id===change.propertyId)!;
     for(const fields of change.payments) property.payments.push({...blank(`bulk-append-${fileIndex}-${property.payments.length}`),...fields});
    }
   }
  } catch(error) { throw new Error(`${fileName}: ${error instanceof Error ? error.message : String(error)}`); }
 });
 const changes: Change[]=[];
 for(const property of simulated.properties) {
  const original=month.properties.find(p=>p.id===property.id);
  if(!original) {
   const additionalPayments=property.payments.slice(5).map(paymentFields);
   changes.push({kind:'addProperty',monthId:month.id,name:property.name,manager:property.manager,totalCents:property.totalCents,...(property.bundleOnly?{bundleOnly:true}:{}),initialPayments:property.payments.slice(0,5).flatMap((p,index)=>p.amountCents===null ? [] : [{index,...paymentFields(p)}]),...(additionalPayments.length ? {additionalPayments} : {})});
  } else {
   if(original.totalCents!==property.totalCents) changes.push({kind:'setTotal',propertyId:property.id,amountCents:property.totalCents});
   const appended: ImportedPayment[]=[];
   for(const payment of property.payments) {
    const before=original.payments.find(p=>p.id===payment.id);
    if(!before) appended.push({...paymentFields(payment), ...(payment.type !== 'Airbnb' ? {type:payment.type} : {})});
    else if(JSON.stringify(before)!==JSON.stringify(payment)) changes.push({kind:'updatePayment',paymentId:payment.id,fields:paymentFields(payment)});
   }
   if(appended.length) changes.push({kind:'appendPayments',propertyId:property.id,payments:appended});
  }
 }
 const writes=changes.reduce((n,c)=>n+(c.kind==='appendPayments' ? c.payments.length : c.kind==='addProperty' ? 1+(c.initialPayments?.length??0)+(c.additionalPayments?.length??0) : 1),0);
 if(writes>500 || changes.length>500) throw new Error('Combined import exceeds 500 payment writes/changes. Split it into smaller batches.');
 return {rows,changes,readyCount:rows.filter(r=>r.status==='ready').length,skippedCount:rows.filter(r=>r.status==='skipped').length,invalidCount:0,unmatchedCount:0};
}
