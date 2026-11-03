import type {AccountManager} from './types.ts';
import {isSafeScreenshot} from './follow-ups.ts';

// Seed only existing Team A/B records. An explicit empty string means removed.
export function defaultManagerProfile(name:string):string {
 const normalized=name.replace(/\s+/g,'').toLowerCase();
 return normalized==='teama'?'team-a':normalized==='teamb'?'team-b':'';
}
export function isValidManagerProfile(value:unknown):value is string {
 return typeof value==='string'&&(value===''||value==='team-a'||value==='team-b'||isSafeScreenshot({name:'Profile',dataUrl:value}));
}
export function managerProfile(manager:Pick<AccountManager,'name'|'profileImage'>):string {
 const value=manager.profileImage??defaultManagerProfile(manager.name);
 return isValidManagerProfile(value)?value:'';
}
export async function prepareManagerProfile(file:File):Promise<string> {
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPEG, or WebP profile image.');
 if(!file.size||file.size>5*1024*1024)throw new Error('Choose a profile image up to 5 MB.');
 const bitmap=await createImageBitmap(file).catch(()=>{throw new Error('This profile image could not be opened. Choose another image.');});
 try {
  if(!bitmap.width||!bitmap.height)throw new Error('This profile image has no dimensions.');
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
  if(!context)throw new Error('Image preparation is unavailable in this browser.');
  for(const edge of [256,192,128]){
   const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height));
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   context.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const png=canvas.toDataURL('image/png');if(isValidManagerProfile(png))return png;
   for(const quality of [.88,.7,.5]){const image=canvas.toDataURL('image/webp',quality);if(isValidManagerProfile(image))return image;}
  }
  throw new Error('This profile image is too detailed to store. Choose a smaller image.');
 }finally{bitmap.close();}
}
