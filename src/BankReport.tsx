import {useState} from 'react';
import {ArrowDownToLine} from 'lucide-react';
import {Dialog} from './App';
import type {Snapshot} from './types.ts';
import {bankLabel,bankReport} from './bank-details.ts';
import {exportBankWorkbook} from './excel';
export default function BankReport({snapshot,monthId,onClose}:{snapshot:Snapshot;monthId:string;onClose:()=>void}){
 const [all,setAll]=useState(true),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState('');
 const month=snapshot.months.find(m=>m.id===monthId)!;
 const banks=[...new Set(month.properties.flatMap(p=>p.payments.filter(payment=>payment.amountCents!==null).map(payment=>bankLabel(payment.bankDetails))))].sort();
 const report=bankReport(month,all?null:selected);
 function download(){try{exportBankWorkbook(snapshot,monthId,all?null:selected);onClose();}catch(cause){setError(cause instanceof Error?cause.message:'Could not download report.');}}
 return <Dialog title="Download Bank Report" subtitle={month.label} onClose={onClose} className="bank-report-dialog"><div className="bank-report-content">
 <p>Download an Excel workbook with bank totals and the matching payment records for this month.</p>
 <label className="bank-choice"><input type="radio" name="bank-report-scope" checked={all} onChange={()=>setAll(true)}/>All Banks</label>
 <label className="bank-choice"><input type="radio" name="bank-report-scope" checked={!all} onChange={()=>setAll(false)}/>Selected Banks</label>
 {!all&&<fieldset className="bank-report-options"><legend>Choose One or More Banks</legend>{banks.map(bank=><label className="bank-choice" key={bank}><input type="checkbox" checked={selected.includes(bank)} onChange={e=>setSelected(current=>e.target.checked?[...current,bank]:current.filter(b=>b!==bank))}/>{bank}</label>)}</fieldset>}
 <p className="field-help">{report.records.length} payment records ? {report.summary.length} banks. Includes all matching records in this month, regardless of overview filters.</p>
 {!banks.length&&<p>No payment records available for this month.</p>}{error&&<p className="form-error" role="alert">{error}</p>}
 <div className="bank-report-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!report.records.length} onClick={download}><ArrowDownToLine size={16}/>Download Excel</button></div>
 </div></Dialog>;
}
