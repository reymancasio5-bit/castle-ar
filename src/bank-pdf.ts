import {statementPageText} from './bank-pdf-layout.ts';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerUrl;
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

