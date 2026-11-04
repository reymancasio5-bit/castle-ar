import test from 'node:test';
import assert from 'node:assert/strict';
import { statementPageText } from '../src/bank-pdf-layout.ts';
import { parseStatement } from '../src/bank-statement.ts';
const item=(str:string,x:number,y:number)=>({str,transform:[1,0,0,1,x,y]});
test('PDF positioning distinguishes credit, debit and balance including split headings',()=>{
 const rows=[item('September 4, 2026 to October 5, 2026',350,750),item('Account number: 00409 103-586-4',350,730),item('Date',20,700),item('Description',65,700),item('Cheques & Debits ($)',290,700),item('Deposits & Credits ($)',400,700),item('Balance ($)',530,700),item('09 Sep',20,670),item('AIRBNB PAYMENTS',65,670),item('00000344234136',65,655),item('6,824.51',440,655),item('20,000.00',540,655),item('10 Sep',20,630),item('AIRBNB PAYMENTS',65,630),item('100.00',330,615),item('19,900.00',540,615)];
 const parsed=parseStatement(statementPageText(rows));assert.deepEqual(parsed.deposits.map(d=>d.amountCents),[682451]);
});
test('unknown PDF column layout never falls back to treating arbitrary numbers as credits',()=>{
 const text=statementPageText([item('September 4, 2026 to October 5, 2026',20,750),item('Account number: 00409 103-586-4',20,730),item('09 Sep AIRBNB PAYMENTS',20,700),item('100.00',330,680),item('20,000.00',540,680)]);
 assert.equal(parseStatement(text).deposits.length,0);
});

test('PDF.js extracts a real PDF stream before the statement parser matches credits',async()=>{
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const lines=[['September 4, 2026 to October 5, 2026',300,750],['Account number: 00409 103-586-4',300,730],['Date',20,700],['Description',65,700],['Cheques & Debits',290,700],['Deposits & Credits',400,700],['Balance',530,700],['09 Sep',20,670],['AIRBNB PAYMENTS',65,670],['00000344234136',65,655],['6,824.51',440,655],['20,000.00',530,655]] as const;
 const stream=lines.map(([text,x,y])=>`BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${text}) Tj ET`).join('\n');
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 const task=getDocument({data:new TextEncoder().encode(pdf),useSystemFonts:true});
 try{const doc=await task.promise;const content=await(await doc.getPage(1)).getTextContent();const items=content.items.filter((i):i is import('pdfjs-dist/types/src/display/api').TextItem=>'str' in i&&!!i.str.trim());const parsed=parseStatement(statementPageText(items));assert.equal(parsed.deposits.length,1);assert.equal(parsed.deposits[0].amountCents,682451);assert.equal(parsed.deposits[0].date,'2026-09-09');}finally{await task.destroy();}
});

test('a missing balance heading cannot turn the running balance into a credit',()=>{
 const text=statementPageText([item('September 4, 2026 to October 5, 2026',20,750),item('Account number: 00409 103-586-4',20,730),item('Cheques & Debits',290,700),item('Deposits & Credits',400,700),item('09 Sep AIRBNB PAYMENTS',20,680),item('100.00',330,660),item('20,000.00',540,660)]);
 assert.equal(parseStatement(text).deposits.length,0);
});
