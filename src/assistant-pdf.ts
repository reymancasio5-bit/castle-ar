import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import type {AssistantReport} from './assistant-types.ts';

const plain=(s:string)=>s.replace(/\*\*|`/g,'').replace(/[–—]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/→/g,'->');
const cells=(s:string)=>s.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>plain(c.trim()));
export async function reportPdf(report:AssistantReport):Promise<ArrayBuffer>{
 const doc=new jsPDF({unit:'mm',format:'a4',compress:true});
 doc.setProperties({title:report.title,author:'Castle Assistant',subject:'AI-generated workspace report'});
 const margin=18,width=174,bottom=276;let y=21;
 doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(45,103,77);doc.text('CASTLE  /  WORKSPACE REPORT',margin,y);y+=12;
 function line(text:string,size=11,bold=false){
  doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(35,54,45);
  const wrapped=doc.splitTextToSize(plain(text),width) as string[];const height=size*.45;
  for(const row of wrapped){if(y+height>bottom){doc.addPage();y=20;}doc.text(row,margin,y);y+=height;}
  y+=3;
 }
 line(report.title,21,true);doc.setDrawColor(65,119,88);doc.line(margin,y,192,y);y+=10;
 const lines=report.markdown.replace(/\r/g,'').split('\n');
 for(let i=0;i<lines.length;){
  const text=lines[i];if(!text.trim()){y+=2;i++;continue;}
  if(i+1<lines.length&&text.includes('|')&&cells(lines[i+1]).every(c=>/^:?-{3,}:?$/.test(c))){
   const head=cells(text),body:string[][]=[];i+=2;
   while(i<lines.length&&lines[i].includes('|'))body.push(cells(lines[i++]));
   if(y>bottom-20){doc.addPage();y=20;}
   autoTable(doc,{head:[head],body,startY:y,margin:{left:margin,right:margin,top:20,bottom:21},styles:{font:'helvetica',fontSize:9,cellPadding:3,overflow:'linebreak'},headStyles:{fillColor:[39,94,68]},alternateRowStyles:{fillColor:[244,248,245]},rowPageBreak:'avoid'});
   y=(doc as jsPDF&{lastAutoTable:{finalY:number}}).lastAutoTable.finalY+8;continue;
  }
  if(/^```/.test(text)||/^---+$/.test(text)){i++;continue;}
  const heading=/^(#{1,4})\s+(.+)$/.exec(text);
  if(heading){if(y>bottom-25){doc.addPage();y=20;}line(heading[2],heading[1].length===1?16:13,true);}else line(text);
  i++;
 }
 const count=doc.getNumberOfPages();
 for(let page=1;page<=count;page++){doc.setPage(page);doc.setDrawColor(215,225,218);doc.line(margin,283,192,283);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(105,120,111);doc.text('AI-generated analysis | Review against source records',margin,289);doc.text(`${page} / ${count}`,192,289,{align:'right'});}
 return doc.output('arraybuffer');
}
