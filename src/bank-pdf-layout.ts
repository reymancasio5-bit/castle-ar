export interface PositionedText {str:string;transform:number[];width?:number}
const amountLike = /^\s*(?:[-(]\s*)?\$?\s*\d[\d,.]*\.\d+/;
export function statementPageText(items: PositionedText[]):string {
   const lines:{y:number;items:PositionedText[]}[]=[];
   for(const item of items){const y=item.transform[5];let line=lines.find(l=>Math.abs(l.y-y)<2);if(!line){line={y,items:[]};lines.push(line);}line.items.push(item);}
   lines.sort((a,b)=>b.y-a.y);
   let debit=Infinity,credit=Infinity,balance=Infinity;
   const output=lines.map(line=>{
    const parts=line.items.sort((a,b)=>a.transform[4]-b.transform[4]);
    const plain=parts.map(i=>i.str).join(' ');
    if (/^(?:Totals\b|Summary of checks written|The Ending Daily Balance|Account Fees:)/i.test(plain)) {
     debit=credit=balance=Infinity;
     return plain;
    }
    if(/\bAdditions\b/i.test(plain)&&/\bSubtractions\b/i.test(plain)&&/\bbalance\b/i.test(plain)){
     credit=parts.find(i=>/Additions/i.test(i.str))?.transform[4]??Infinity;
     debit=parts.find(i=>/Subtractions/i.test(i.str))?.transform[4]??Infinity;
     balance=parts.find(i=>/balance/i.test(i.str))?.transform[4]??Infinity;
     return plain;
    }
    if(/Cheques\s*[&]\s*Debits/i.test(plain)&&/Deposits\s*[&]\s*Credits/i.test(plain)){
     debit=parts.find(i=>/Cheques|Debits/i.test(i.str))?.transform[4]??Infinity;
     credit=parts.find(i=>/Deposits|Credits/i.test(i.str))?.transform[4]??Infinity;
     balance=parts.find(i=>/Balance/i.test(i.str))?.transform[4]??Infinity;
     return plain;
    }
    if(Number.isFinite(debit)&&Number.isFinite(credit)&&Number.isFinite(balance)&&debit!==credit&&Math.max(debit,credit)<balance&&parts.some(i=>amountLike.test(i.str))){
     const columns=['','','',''];
     // Money is right-aligned: a large balance starts left of its heading.
     for(const item of parts){const x=item.transform[4]+(amountLike.test(item.str)?item.width??0:0);const col=x>=balance-3?3:credit<debit?(x>=debit-3?1:x>=credit-3?2:0):(x>=credit-3?2:x>=debit-3?1:0);columns[col]+=(columns[col]?' ':'')+item.str;}
     return columns.join('\t');
    }
    return plain;
   });

 return output.join('\n');
}
