import type {AssistantReport} from './assistant-types.ts';
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
// Escape first. Only this renderer's fixed, non-interactive tags become HTML.
function inline(text:string):string {
 return text.split(/(`[^`]+`)/g).map(part=>part.startsWith('`')?`<code>${escape(part.slice(1,-1))}</code>`:escape(part).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>')).join('');
}
function cells(line:string){return line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());}
export function markdownHtml(text:string):string {
 const lines=text.replace(/\r/g,'').split('\n'),out:string[]=[];
 for(let i=0;i<lines.length;){
  const line=lines[i];if(!line.trim()){i++;continue;}
  if(/^```/.test(line)){const code:string[]=[];i++;while(i<lines.length&&!/^```/.test(lines[i]))code.push(lines[i++]);i++;out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);continue;}
  const heading=/^(#{1,4})\s+(.+)$/.exec(line);if(heading){const level=Math.min(heading[1].length+1,5);out.push(`<h${level}>${inline(heading[2])}</h${level}>`);i++;continue;}
  if(i+1<lines.length&&line.includes('|')&&cells(lines[i+1]).every(c=>/^:?-{3,}:?$/.test(c))){
   const headers=cells(line);i+=2;const rows:string[]=[];while(i<lines.length&&lines[i].includes('|'))rows.push('<tr>'+cells(lines[i++]).map(c=>`<td>${inline(c)}</td>`).join('')+'</tr>');
   out.push('<div class="assistant-table-wrap"><table><thead><tr>'+headers.map(c=>`<th>${inline(c)}</th>`).join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>');continue;
  }
  const list=/^\s*(?:[-*]|\d+\.)\s+/.test(line);if(list){const ordered=/^\s*\d+\./.test(line),tag=ordered?'ol':'ul',items:string[]=[];const pattern=ordered?/^\s*\d+\.\s+/:/^\s*[-*]\s+/;while(i<lines.length&&pattern.test(lines[i]))items.push(`<li>${inline(lines[i++].replace(pattern,''))}</li>`);out.push(`<${tag}>${items.join('')}</${tag}>`);continue;}
  if(/^\s*---+\s*$/.test(line)){out.push('<hr>');i++;continue;}
  out.push(`<p>${inline(line)}</p>`);i++;
 }
 return out.join('\n');
}
export function reportRows(report:AssistantReport):string[][] {
 return [[report.title],[],...report.markdown.split('\n').filter(line=>!line.includes('|')||!cells(line).every(c=>/^:?-{3,}:?$/.test(c))).map(line=>line.includes('|')?cells(line):[line.replace(/^#{1,6}\s+/,'').replace(/\*\*/g,'')])];
}
export async function downloadReport(report:AssistantReport){
 const filename=report.title.replace(/[^a-z0-9 -]/gi,'').trim().slice(0,70)||'Castle report';
 if(report.format==='xlsx'){const {downloadAssistantWorkbook}=await import('./excel.ts');downloadAssistantWorkbook(reportRows(report),filename);return;}
 const blob=report.format==='pdf'?new Blob([await (await import('./assistant-pdf.ts')).reportPdf(report)],{type:'application/pdf'}):new Blob([report.title+'\n\n'+report.markdown],{type:'text/plain;charset=utf-8'});
 const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename+'.'+report.format;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
