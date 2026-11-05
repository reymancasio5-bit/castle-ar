import type {AssistantAttachment} from './assistant-types.ts';
export async function readAssistantFile(file:File):Promise<AssistantAttachment> {
 if(!file.size||file.size>10*1024*1024)throw new Error('Choose a non-empty file up to 10 MB.');
 const base={id:crypto.randomUUID(),name:file.name.slice(0,160)};
 if(/\.(png|jpe?g|webp)$/i.test(file.name)){
  const bitmap=await createImageBitmap(file);
  try {
   const scale=Math.min(1,2000/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
   const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Unable to read this screenshot.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const dataUrl=canvas.toDataURL('image/jpeg',.88);if(dataUrl.length>2500000)throw new Error('Screenshot is too large. Crop to the relevant area and try again.');
   return {...base,kind:'image',dataUrl};
  }finally{bitmap.close();}
 }
 let text='';
 if(/\.pdf$/i.test(file.name))text=await (await import('./bank-pdf')).extractAssistantPdfText(file);
 else if(/\.(xlsx|xls|csv)$/i.test(file.name)){
  const sheets=await (await import('./excel')).readSpreadsheet(file);
  text=sheets.map(sheet=>{if(sheet.error)throw new Error(sheet.error);return `Sheet: ${sheet.name}\n`+sheet.rows.map((row,i)=>`${i+1}: `+row.map(cell=>String(cell.formatted??cell.value??'')).join('\t')).join('\n');}).join('\n\n');
 }else if(/\.(txt|md)$/i.test(file.name))text=await file.text();
 else throw new Error('Attach PDF, Excel, CSV, TXT, Markdown, PNG, JPG, or WebP.');
 if(!text.trim())throw new Error('This file contains no readable text. For scanned documents, attach a screenshot of the relevant page.');
 if(text.length>18000)text='[EXCERPT ONLY: only the beginning of this file is provided for chat analysis. Do not claim to have reviewed the entire file. The full original file remains available for the import review.]\n'+text.slice(0,17000);
 return {...base,kind:'document',text};
}
