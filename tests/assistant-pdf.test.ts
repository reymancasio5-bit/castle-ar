import test from 'node:test';
import assert from 'node:assert/strict';
import {reportPdf} from '../src/assistant-pdf.ts';
test('reports are real paginated PDFs with complete table rows and footers',async()=>{
 const markdown='# Collection summary\n\nReceived: **$35.00**. Outstanding: $65.00.\n\n| Property | Received | Outstanding |\n| --- | --- | --- |\n'+Array.from({length:90},(_,i)=>`| Property ${i+1} | $35.00 | $65.00 |`).join('\n')+'\n\n## Recommendations\n- Review unmatched deposits.\n- Follow up with account managers.';
 const bytes=await reportPdf({title:'November 2026 portfolio report',markdown,format:'pdf'});
 assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const loading=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});const doc=await loading.promise;
 try{assert.ok(doc.numPages>=3);let text='';for(let page=1;page<=doc.numPages;page++){const p=await doc.getPage(page);text+=(await p.getTextContent()).items.map(i=>'str' in i?i.str:'').join(' ');}
 assert.match(text,/Property 90/);assert.match(text,/Recommendations/);assert.match(text,/Review against source records/);
 }finally{await loading.destroy();}
});
