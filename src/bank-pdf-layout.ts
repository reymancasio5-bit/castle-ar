export interface PositionedText {str:string;transform:number[]}
export function statementPageText(items: PositionedText[]):string {
   const lines:{y:number;items:PositionedText[]}[]=[];
   for(const item of items){const y=item.transform[5];let line=lines.find(l=>Math.abs(l.y-y)<2);if(!line){line={y,items:[]};lines.push(line);}line.items.push(item);}
   lines.sort((a,b)=>b.y-a.y);
   let debit=Infinity,credit=Infinity,balance=Infinity;
   const output=lines.map(line=>{
    const parts=line.items.sort((a,b)=>a.transform[4]-b.transform[4]);
    const plain=parts.map(i=>i.str).join(' ');
    if(/Cheques\s*[&]\s*Debits/i.test(plain)&&/Deposits\s*[&]\s*Credits/i.test(plain)){
     debit=parts.find(i=>/Cheques|Debits/i.test(i.str))?.transform[4]??Infinity;
     credit=parts.find(i=>/Deposits|Credits/i.test(i.str))?.transform[4]??Infinity;
     balance=parts.find(i=>/Balance/i.test(i.str))?.transform[4]??Infinity;
     return plain;
    }
    if(Number.isFinite(debit)&&Number.isFinite(credit)&&Number.isFinite(balance)&&debit<credit&&credit<balance&&parts.some(i=>/^\s*[\d,]+\.\d{2}\s*$/.test(i.str))){
     const columns=['','','',''];
     for(const item of parts){const x=item.transform[4];const col=x>=balance-3?3:x>=credit-3?2:x>=debit-3?1:0;columns[col]+=(columns[col]?' ':'')+item.str;}
     return columns.join('\t');
    }
    return plain;
   });

 return output.join('\n');
}
