import type {Property, Month} from './types.ts';
export function extractBankDetails(value:unknown):string {
 const match=String(value??'').match(/\b(checking|chequing|savings)\s+([\d*xX?-]*\d[\d*xX?-]*)\b/i);
 return match ? match[1][0].toUpperCase()+match[1].slice(1).toLowerCase()+' '+match[2] : '';
}
export const bankLabel=(value?:string)=>value?.trim()||'Not Specified';
export const propertyBanks=(property:Property)=>[...new Set(property.payments.map(p=>p.bankDetails?.trim()).filter((v):v is string=>!!v))].sort();
export function bankReport(month:Month,selected:string[]|null){
 const payments=month.properties.flatMap(property=>property.payments.filter(p=>p.amountCents!==null).map(payment=>({property,payment,bank:bankLabel(payment.bankDetails)}))).filter(row=>selected===null||selected.includes(row.bank)).sort((a,b)=>a.bank.localeCompare(b.bank)||a.property.name.localeCompare(b.property.name)||a.payment.payoutDate.localeCompare(b.payment.payoutDate));
 const banks=[...new Set(payments.map(row=>row.bank))];
 const summary=banks.map(bank=>{const rows=payments.filter(row=>row.bank===bank);return {Bank:bank,Properties:new Set(rows.map(row=>row.property.id)).size,Payments:rows.length,'Recorded Payments':rows.reduce((sum,row)=>sum+(row.payment.amountCents??0),0)/100};});
 const records=payments.map(({property,payment,bank})=>({'Bank Details':bank,Property:property.name,'Account Manager':property.manager,Source:payment.type,'Payout Date':payment.payoutDate,'Payment Amount':(payment.amountCents??0)/100,'Bank Received Date':payment.bankDate,'Bank Received Amount':payment.bankCents===null?null:payment.bankCents/100,'Verified by Daisy':payment.verifiedByDaisy?'Yes':'No'}));
 return {summary,records,total:payments.reduce((sum,row)=>sum+(row.payment.amountCents??0),0)/100};
}
