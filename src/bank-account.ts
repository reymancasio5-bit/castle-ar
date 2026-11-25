import type {Snapshot} from './types.ts';

export function payoutAccount(details='') {
 const match=details.match(/\b(?:checking|chequing|savings)\s+([\dxX*?][\dxX*? -]*)/i);
 const digits=match?.[1].replace(/[ -]/g,'')??'';
 const currency=(details.match(/\(([a-z]{3})\)\s*$/i)??details.match(/\b(CAD|USD)\b/i))?.[1].toUpperCase();
 return {mask:/[xX*?]/.test(digits)?digits:'',suffix:digits.match(/\d{4}$/)?.[0]??'',identity:/^\d{5,34}$/.test(digits)?digits:'',currency};
}
export function maskedAccountMatches(mask:string,identity:string){
 if(!mask)return true;
 if(/^\d{4}$/.test(identity))return mask.endsWith(identity);
 const ends=mask.match(/^(\d*)[xX*?]+(\d*)$/);
 if(ends)return identity.length>ends[1].length+ends[2].length&&identity.startsWith(ends[1])&&identity.endsWith(ends[2]);
 return mask.length===identity.length&&Array.from(mask).every((digit,i)=>/[xX*?]/.test(digit)||digit===identity[i]);
}
export const isFullAccountIdentity=(identity?:string)=>!!identity&&/^\d{5,34}$/.test(identity);
export const compatibleAccountIdentity=(a?:string,b?:string)=>!isFullAccountIdentity(a)||!isFullAccountIdentity(b)||a===b;
export function compatibleAccountMasks(a:string,b:string):boolean {
 function digitsAt(mask:string,length:number):(string|undefined)[]|undefined {
  const ends=mask.match(/^(\d*)[xX*?]+(\d*)$/);
  if(ends){
   if(length<=ends[1].length+ends[2].length)return;
   const digits=new Array<string|undefined>(length).fill(undefined);
   Array.from(ends[1]).forEach((digit,i)=>digits[i]=digit);
   Array.from(ends[2]).forEach((digit,i)=>digits[length-ends[2].length+i]=digit);
   return digits;
  }
  if(mask.length!==length)return;
  return Array.from(mask,digit=>/\d/.test(digit)?digit:undefined);
 }
 for(let length=5;length<=34;length++){
  const left=digitsAt(a,length),right=digitsAt(b,length);
  if(left&&right&&left.every((digit,i)=>!digit||!right[i]||digit===right[i]))return true;
 }
 return false;
}
export const validSourceAccount=(account:string,identity?:string)=>/^\d{4}$/.test(account)&&!!identity&&/^\d{4,34}$/.test(identity)&&identity.slice(-4)===account;
export const receiptKey=(identity:string,reference:string)=>JSON.stringify([identity,reference.trim().toLowerCase()]);
type SourceIdentity={account:string;accountIdentity?:string;reference:string};
export function sameBankReference(a:SourceIdentity,b:SourceIdentity){
 return a.reference.trim().toLowerCase()===b.reference.trim().toLowerCase()&&a.account===b.account&&compatibleAccountIdentity(a.accountIdentity,b.accountIdentity);
}
export function accountDirectory(){
 const identities=new Map<string,Set<string>>(),currencies=new Map<string,Set<string>>(),patterns=new Map<string,Set<string>>(),collisions=new Set<string>();
 function add(index:Map<string,Set<string>>,key:string,value?:string){if(!key||!value)return;const values=index.get(key)??new Set();values.add(value);index.set(key,values);}
 const resolve=(suffix:string,identity?:string)=>isFullAccountIdentity(identity)?identity!:identities.get(suffix)?.size===1?[...identities.get(suffix)!][0]:suffix;
 const ambiguous=(suffix:string,identity?:string)=>!isFullAccountIdentity(identity)&&collisions.has(suffix);
 const compatible=(details:string|undefined,account:string,identity:string,currency:string)=>{
  const target=payoutAccount(details),resolved=resolve(account,identity);
  return target.suffix===account&&maskedAccountMatches(target.mask,resolved)&&(!target.identity||compatibleAccountIdentity(target.identity,resolved))&&(!target.currency||target.currency===currency);
 };
 return {
  observe(suffix:string,identity?:string,currency?:string,mask?:string){
   if(isFullAccountIdentity(identity))add(identities,suffix,identity);
   const pattern=isFullAccountIdentity(identity)?identity:mask;
   if(pattern&&!patterns.get(suffix)?.has(pattern)){
    if([...(patterns.get(suffix)??[])].some(known=>!compatibleAccountMasks(known,pattern)))collisions.add(suffix);
    add(patterns,suffix,pattern);
   }
   add(currencies,isFullAccountIdentity(identity)?identity!:suffix,currency);
  },
  resolve,ambiguous,compatible,
  key(account:string,identity:string|undefined,reference:string){return receiptKey(resolve(account,identity),reference);},
  matches(details:string|undefined,account:string,identity:string,currency:string){
   const target=payoutAccount(details),resolved=resolve(account,identity);
   if(ambiguous(account,identity)||!compatible(details,account,identity,currency))return false;
   if(!target.identity&&collisions.has(account))return false;
   if(!target.currency&&[...(currencies.get(resolved)??[]),...(currencies.get(account)??[])].some(c=>c!==currency))return false;
   return true;
  }
 };
}

/** Observe known full accounts before resolving aliases; never replace source evidence. */
export function snapshotAccountDirectory(snapshot:Pick<Snapshot,'months'|'bankReceipts'|'ownerTransfers'>,sources:{account:string;accountIdentity?:string;currency?:string}[]=[]){
 const directory=accountDirectory();
 for(const source of [...(snapshot.bankReceipts??[]),...(snapshot.ownerTransfers??[]),...sources])directory.observe(source.account,source.accountIdentity,source.currency);
 for(const month of snapshot.months)for(const property of month.properties)for(const payment of property.payments){const b=payoutAccount(payment.bankDetails);directory.observe(b.suffix,b.identity,b.currency,b.mask);}
 return directory;
}

