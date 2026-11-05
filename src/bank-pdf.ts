import {statementPageText} from './bank-pdf-layout.ts';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerUrl;
/** General document reading, separate from the bank-column extraction rules. */
export async function extractAssistantPdfText(file:File):Promise<string>{
 const task=getDocument({data:new Uint8Array(await file.arrayBuffer())});
 try {
  const pdf=await task.promise;if(pdf.numPages>100)throw new Error('Attach a PDF with at most 100 pages.');
  const pages:string[]=[];let length=0;
  for(let n=1;n<=pdf.numPages;n++){
   const page=await pdf.getPage(n),content=await page.getTextContent();
   const text=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('');length+=text.length;
   if(length>17000){page.cleanup();return '[EXCERPT ONLY: this PDF has '+pdf.numPages+' pages. Only the beginning is provided for chat analysis. Do not claim to have reviewed the entire file. The full original file remains available for the import review.]\n'+(pages.join('\n\n')+'\n'+text).slice(0,17000);}
   pages.push(`Page ${n}\n${text}`);page.cleanup();
  }
  if(pages.join('').replace(/Page \d+/g,'').trim().length<10)throw new Error('This is a scanned PDF. Attach a screenshot of the relevant page so the assistant can read it.');
  return pages.join('\n\n');
 }finally{await task.destroy();}
}
/** Preserve columns: the parser must never mistake a debit or balance for a credit. */
export async function extractStatementText(file: File): Promise<string> {
 if(file.size>20*1024*1024)throw new Error('Choose a PDF smaller than 20 MB.');
 const task=getDocument({data:new Uint8Array(await file.arrayBuffer())});
 try {
  const pdf=await task.promise;
  if(pdf.numPages>100)throw new Error('Choose a statement with at most 100 pages.');
  const pages:string[]=[];
  for(let n=1;n<=pdf.numPages;n++){
   const page=await pdf.getPage(n),content=await page.getTextContent();
   const items=content.items.filter((i):i is import('pdfjs-dist/types/src/display/api').TextItem=>'str' in i && !!i.str.trim());
   pages.push(statementPageText(items));page.cleanup();
  }
  const text=pages.join('\n');
  if(text.trim().length<40)throw new Error('This PDF has no readable text. Use a text-based bank statement, or run OCR on the PDF before importing it.');
  return text;
 } finally { await task.destroy(); }
}

