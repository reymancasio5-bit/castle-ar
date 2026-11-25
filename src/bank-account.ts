export function payoutAccount(details='') {
 const match=details.match(/\b(?:checking|chequing|savings)\s+([\dxX*?][\dxX*? -]*)/i);
 const digits=match?.[1].replace(/[ -]/g,'')??'';
 const currency=(details.match(/\(([a-z]{3})\)\s*$/i)??details.match(/\b(CAD|USD)\b/i))?.[1].toUpperCase();
 return {mask:/[xX*?]/.test(digits)?digits:'',suffix:digits.match(/\d{4}$/)?.[0]??'',identity:/^\d{5,34}$/.test(digits)?digits:'',currency};
}
export function maskedAccountMatches(mask:string,identity:string){
 if(!mask)return true;
 const ends=mask.match(/^(\d*)[xX*?]+(\d*)$/);
 if(ends)return identity.length>ends[1].length+ends[2].length&&identity.startsWith(ends[1])&&identity.endsWith(ends[2]);
 return mask.length===identity.length&&Array.from(mask).every((digit,i)=>/[xX*?]/.test(digit)||digit===identity[i]);
}
export const validSourceAccount=(account:string,identity?:string)=>!!identity&&/^\d{5,34}$/.test(identity)&&identity.slice(-4)===account;
export const receiptKey=(identity:string,reference:string)=>JSON.stringify([identity,reference.trim().toLowerCase()]);
type SourceIdentity={account:string;accountIdentity?:string;reference:string};
export function sameBankReference(a:SourceIdentity,b:SourceIdentity){
 return a.reference.trim().toLowerCase()===b.reference.trim().toLowerCase()&&a.account===b.account&&(!a.accountIdentity||!b.accountIdentity||a.accountIdentity===b.accountIdentity);
}
export function accountDirectory(){
 const identities=new Map<string,Set<string>>(),currencies=new Map<string,Set<string>>();
 function add(index:Map<string,Set<string>>,key:string,value?:string){if(!key||!value)return;const values=index.get(key)??new Set();values.add(value);index.set(key,values);}
 return {
  observe(suffix:string,identity?:string,currency?:string){add(identities,suffix,identity);add(currencies,identity||suffix,currency);},
  matches(details:string|undefined,account:string,identity:string,currency:string){
   const target=payoutAccount(details);
   if(target.suffix!==account||!maskedAccountMatches(target.mask,identity)||(target.identity&&target.identity!==identity)||(target.currency&&target.currency!==currency))return false;
   if(!target.identity&&(identities.get(account)?.size??0)>1)return false;
   if(!target.currency&&((currencies.get(identity)?.size??0)>1||[...(currencies.get(account)??[])].some(c=>c!==currency)))return false;
   return true;
  }
 };
}

