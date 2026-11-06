import {useState} from 'react';
import {ArrowDownToLine, Building2, CheckCheck, ChevronRight, ClipboardCheck, Search, Upload} from 'lucide-react';
import type {Month, Property} from './types';
import {money, systemStatus} from './domain';
import './bundle-matching.css';

export default function BundleMatching({month,onImport,onBankImport,onOpen,onExport}:{month:Month;onImport:()=>void;onBankImport:()=>void;onOpen:(property:Property)=>void;onExport:()=>void}){
 const [search,setSearch]=useState(''),[status,setStatus]=useState('all');
 const properties=month.properties.filter(p=>p.bundleOnly);
 const rows=properties.flatMap(property=>property.payments.map(payment=>({property,payment})));
 const matched=rows.filter(r=>systemStatus(r.payment)==='Matched').length;
 const filtered=rows.filter(({property,payment})=>(status==='all'||systemStatus(payment)===status)&&`${property.name} ${property.manager} ${payment.bankDetails??''}`.toLowerCase().includes(search.trim().toLowerCase()));
 return <div className="bundle-report">
  <section className="bundle-intro"><span className="bundle-intro-icon"><ClipboardCheck size={25}/></span><div><strong>Confirm every Airbnb deposit</strong><p>Match payout bundles to your bank statement using the amount and bank account. These payments are tracked separately from accounts receivable.</p></div><span className="bundle-mode">Bundle matching only</span></section>
  <section className="bundle-metrics" aria-label="Bundle matching totals">
   <article><span>Airbnb payments</span><strong>{money(rows.reduce((sum,r)=>sum+(r.payment.amountCents??0),0))}</strong><small>{properties.length} properties · {rows.length} payment rows</small></article>
   <article><span>Matched payment rows</span><strong>{matched}<small> / {rows.length}</small></strong><small>Confirmed against bank deposits</small></article>
   <article><span>Awaiting a match</span><strong>{rows.length-matched}</strong><small>Pending or requiring review</small></article>
  </section>
  <section className="panel bundle-panel">
   <div className="panel-heading"><div><h2>Airbnb Deposit Register<span className="count-pill">{rows.length}</span></h2><p>Payment amounts and payout bundles, with their bank matching results.</p></div><div className="panel-actions"><button className="button secondary compact" onClick={onImport}><Upload size={16}/>Import Excel / CSV</button><button className="button primary compact" onClick={onBankImport}><Upload size={16}/>Import Bank Statement</button></div></div>
   <div className="bundle-filters"><label className="search-field"><Search size={17}/><input aria-label="Search bundle payments" placeholder="Search property, manager or bank…" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Bundle match status" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All match statuses</option><option>Matched</option><option>Pending</option><option>Mismatch</option></select></div>
   {filtered.length?<div className="table-scroll"><table className="reconciliation-table"><thead><tr><th>Property</th><th className="number">Airbnb Payment</th><th>Payout Date</th><th className="number">Bundle Amount</th><th>Bank Details</th><th>Bank Date</th><th>System Check</th><th>Daisy Check</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{filtered.map(({property,payment})=><tr key={payment.id}><td><button className="table-property-button" onClick={()=>onOpen(property)}><strong>{property.name}</strong><span>{property.manager}</span></button></td><td className="number">{money(payment.amountCents)}</td><td>{payment.payoutDate||'—'}</td><td className="number">{money(payment.bundleCents)}</td><td>{payment.bankDetails||'Not specified'}</td><td>{payment.bankDate||'—'}</td><td><span className={`status-badge ${systemStatus(payment)==='Matched'?'paid':'partial'}`}>{systemStatus(payment)==='Matched'&&<CheckCheck size={14}/>} {systemStatus(payment)}</span></td><td>{payment.verifiedByDaisy?'Verified':'Pending'}</td><td><button className="icon-button" aria-label={`Open ${property.name}`} onClick={()=>onOpen(property)}><ChevronRight size={17}/></button></td></tr>)}</tbody></table></div>:<div className="empty-state compact-empty"><Building2 size={30}/><h3>{rows.length?'No matching payments':'Start matching your Airbnb deposits'}</h3><p>{rows.length?'Try another search or match status.':'Import an Airbnb Excel or CSV file and leave Expected Amount blank or enter 0.'}</p>{!rows.length&&<button className="button secondary" onClick={onImport}><Upload size={16}/>Import Airbnb Payments</button>}</div>}
   <div className="table-footer"><span>{filtered.length} payment rows · Shared bundles may appear on multiple rows</span><button onClick={onExport}><ArrowDownToLine size={15}/>Export Workbook</button></div>
  </section>
 </div>;
}
