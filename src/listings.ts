import type {Listing, ListingChange, Snapshot} from './types.ts';
import {ownerKey} from './owners.ts';

export const listingOwners=(snapshot:Snapshot,name:string)=>(snapshot.owners??[]).filter(o=>o.propertyNames.some(n=>ownerKey(n)===ownerKey(name)));
export function listingCatalog(snapshot:Snapshot):Listing[]{
 const catalog=new Map((snapshot.listings??[]).map(l=>[ownerKey(l.name),l]));
 for(const month of snapshot.months)for(const p of month.properties){
  const key=ownerKey(p.name);
  if(!p.bundleOnly&&!catalog.has(key))catalog.set(key,{id:'existing:'+key,name:p.name,managerId:p.managerId??''});
 }
 return [...catalog.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function listingSuggestions(snapshot:Snapshot){
 return listingCatalog(snapshot).map(l=>({name:l.name,manager:snapshot.managers?.find(m=>m.id===l.managerId)?.name??''}));
}
export function applyListingChange(snapshot:Snapshot,change:ListingChange){
 if(snapshot.listingSchema!==1)throw new Error('Update the Apps Script deployment to save listings.');
 const {listing,ownerId}=change,old=listingCatalog(snapshot).find(l=>l.id===listing.id);
 if(typeof listing.id!=='string'||!listing.id||listing.id.length>250)throw new Error('Invalid listing ID.');
 if(typeof listing.name!=='string'||!listing.name.trim()||listing.name.length>160||/^[=+@-]/.test(listing.name.trim())||/[\u0000-\u001f\u007f]/.test(listing.name))throw new Error('Enter a valid listing name.');
 if(old&&listing.name!==old.name)throw new Error('Existing listing names cannot be changed here.');
 if(listingCatalog(snapshot).some(l=>l.id!==listing.id&&ownerKey(l.name)===ownerKey(listing.name)))throw new Error('A listing with this name already exists.');
 const manager=snapshot.managers?.find(m=>m.id===listing.managerId),owner=snapshot.owners?.find(o=>o.id===ownerId);
 if(typeof listing.managerId!=='string'||(listing.managerId&&(!manager||(!manager.active&&old?.managerId!==manager.id))))throw new Error('Choose an active registered account manager.');
 if(typeof ownerId!=='string'||(ownerId&&(!owner||(!owner.active&&!listingOwners(snapshot,listing.name).some(o=>o.id===ownerId)))))throw new Error('Choose an active registered owner.');
 const saved={...listing,name:listing.name.trim()};
 snapshot.listings=[...(snapshot.listings??[]).filter(l=>l.id!==listing.id),saved];
 for(const o of snapshot.owners??[]){o.propertyNames=o.propertyNames.filter(n=>ownerKey(n)!==ownerKey(saved.name));if(o.id===ownerId)o.propertyNames.push(saved.name);}
 for(const month of snapshot.months)for(const p of month.properties)if(ownerKey(p.name)===ownerKey(saved.name)){p.managerId=manager?.id??'';p.manager=manager?.name??'';}
}
