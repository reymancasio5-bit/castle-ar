import type {Change, FollowUpAttachment, FollowUpStatus, Property} from './types.ts';
export const followUpStatuses: {value: FollowUpStatus; label: string}[] = [
 {value:'not_contacted',label:'Not contacted'}, {value:'contact_attempted',label:'Contact attempted'},
 {value:'awaiting_response',label:'Awaiting owner response'}, {value:'owner_responded',label:'Owner responded'},
 {value:'payment_promised',label:'Payment promised'}, {value:'follow_up_needed',label:'Follow-up needed'}, {value:'resolved',label:'Resolved'},
];
export interface FollowUpDraft {manager:string;status:FollowUpStatus;note:string;attachments:FollowUpAttachment[]}
export function followUpDraft(property:Property):FollowUpDraft {
 return {manager:property.manager,status:property.followUp?.status??'not_contacted',note:property.followUp?.note??'',attachments:(property.followUp?.attachments??[]).map(a=>({...a}))};
}
export function isSafeScreenshot(attachment:FollowUpAttachment):boolean {
 if(!attachment || typeof attachment.name!=='string' || !attachment.name.trim() || attachment.name.length>160 || /[\u0000-\u001f\u007f]/.test(attachment.name) || typeof attachment.dataUrl!=='string' || attachment.dataUrl.length>45000 || JSON.stringify(attachment).length>48000) return false;
 const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(attachment.dataUrl);
 if(!match || match[2].length%4!==0) return false;
 return match[1]==='jpeg' ? match[2].startsWith('/9j/') : match[1]==='png' ? match[2].startsWith('iVBORw0KGgo') : match[2].startsWith('UklGR');
}
export function validateFollowUpDraft(draft:FollowUpDraft):void {
 if(!followUpStatuses.some(s=>s.value===draft.status)) throw new Error('Choose a valid follow-up status.');
 if(typeof draft.manager!=='string' || draft.manager.trim().length>160 || /^[=+@-]/.test(draft.manager.trim()) || /[\u0000-\u001f\u007f]/.test(draft.manager)) throw new Error('Enter a valid account manager, or leave unassigned.');
 if(typeof draft.note!=='string' || draft.note.length>5000) throw new Error('Notes must be 5,000 characters or fewer.');
 if(!Array.isArray(draft.attachments) || draft.attachments.length>3) throw new Error('Attach up to three screenshots.');
 if(draft.attachments.some(a=>!isSafeScreenshot(a))) throw new Error('A screenshot is invalid or too large. Remove it and upload a PNG, JPEG, or WebP image again.');
}
export const followUpDirty=(initial:FollowUpDraft,draft:FollowUpDraft)=>JSON.stringify(initial)!==JSON.stringify(draft);
export function buildFollowUpChange(propertyId:string,draft:FollowUpDraft):Change {
 validateFollowUpDraft(draft);
 return {kind:'updateFollowUp',propertyId,manager:draft.manager.trim(),status:draft.status,note:draft.note,attachments:draft.attachments.map(a=>({...a}))};
}
export async function prepareScreenshot(file:File):Promise<FollowUpAttachment> {
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP screenshot.');
 if(file.size>10*1024*1024) throw new Error('Each source screenshot must be 10 MB or smaller.');
 if(!file.size) throw new Error('This screenshot is empty.');
 const bitmap=await createImageBitmap(file).catch(()=>{throw new Error('This image could not be decoded. Choose another screenshot.');});
 try {
  if(!bitmap.width || !bitmap.height) throw new Error('This screenshot has no image dimensions.');
  const canvas=document.createElement('canvas');const context=canvas.getContext('2d');
  if(!context) throw new Error('Image compression is unavailable in this browser.');
  let edge=1600;
  for(let size=0;size<9;size++,edge=Math.floor(edge*.8)) {
   const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height));
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
   for(const quality of [.82,.68,.54,.4]) {
    const attachment={name:(file.name.replace(/[\u0000-\u001f\u007f]/g,'').trim()||'Screenshot').slice(0,160),dataUrl:canvas.toDataURL('image/jpeg',quality)};
    if(isSafeScreenshot(attachment)) return attachment;
   }
  }
  throw new Error('This screenshot is too detailed to store. Crop it to the relevant conversation and try again.');
 } finally {bitmap.close();}
}

