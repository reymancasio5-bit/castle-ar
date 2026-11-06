import {useState} from 'react';
import {ArrowDownToLine, ArrowLeft, Building2, CheckCheck, ChevronRight, ClipboardCheck, Search, Upload} from 'lucide-react';
import type {Month, Payment, Property} from './types';
import {money, systemStatus} from './domain';
import './bundle-matching.css';

export default function BundleMatching({month,onImport,onBankImport,onOpen,onExport}:{month:Month;onImport:()=>void;onBankImport:()=>void;onOpen:(property:Property)=>void;onExport:()=>void}){
 const [search,setSearch]=useState(''),[status,setStatus]=useState('all');
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const allProperties=month.properties.filter(p=>p.bundleOnly);
 const selectedProperty=allProperties.find(p=>p.id===selectedId);
 const properties=selectedProperty?[selectedProperty]:allProperties;
 const rows=properties.flatMap(property=>property.payments.map(payment=>({property,payment})));
 const matched=rows.filter(r=>systemStatus(r.payment)==='Matched').length;
 const filtered=rows.filter(({property,payment})=>(status==='all'||systemStatus(payment)===status)&&`${property.name} ${property.manager} ${payment.bankDetails??''}`.toLowerCase().includes(search.trim().toLowerCase()));
 const matchingIds=new Set(filtered.map(row=>row.property.id));
 const visibleProperties=properties.filter(property=>matchingIds.has(property.id)||(!property.payments.length&&status==='all'&&
  `${property.name} ${property.manager}`.toLowerCase().includes(search.trim().toLowerCase()))).slice().sort((a,b)=>a.name.localeCompare(b.name));
 return <div className="bundle-report">
  {selectedProperty&&<div className="bundle-property-navigation"><button className="button secondary compact" onClick={()=>setSelectedId(null)}><ArrowLeft size={16}/>Back to properties</button><span>{selectedProperty.name}</span></div>}
  <aside className="bundle-intro" aria-label="Bundle matching information"><span className="bundle-intro-icon"><ClipboardCheck size={18} aria-hidden="true"/></span><p><strong>Bundle matching only</strong><span>Match Airbnb bundles by amount and bank account. Tracked separately from AR.</span></p></aside>
  <section className="bundle-metrics" aria-label="Bundle matching totals">
   <article><span>Airbnb payments</span><strong>{money(rows.reduce((sum,r)=>sum+(r.payment.amountCents??0),0))}</strong><small>{properties.length} {properties.length===1?'property':'properties'} · {rows.length} payment rows</small></article>
   <article><span>Matched payment rows</span><strong>{matched}<small> / {rows.length}</small></strong><small>Confirmed against bank deposits</small></article>
   <article><span>Awaiting a match</span><strong>{rows.length-matched}</strong><small>Pending or requiring review</small></article>
  </section>
  <section className="panel bundle-panel">
   <div className="panel-heading"><div><h2>{selectedProperty?selectedProperty.name:'Bundle Matching Properties'}<span className="count-pill">{selectedProperty?rows.length:allProperties.length}</span></h2><p>{selectedProperty?'Payment amounts and payout bundles, with their bank matching results.':'Select a property to view its Airbnb payments and bank matches.'}</p></div><div className="panel-actions"><button className="button secondary compact" onClick={onImport}><Upload size={16}/>Import Excel / CSV</button><button className="button primary compact" onClick={onBankImport}><Upload size={16}/>Import Bank Statement</button></div></div>
   <div className="bundle-filters"><label className="search-field"><Search size={17}/><input aria-label="Search bundle payments" placeholder="Search property, manager or bank…" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Bundle match status" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All match statuses</option><option>Matched</option><option>Pending</option><option>Mismatch</option></select></div>
   {!selectedProperty&&visibleProperties.length?<div className="table-scroll"><table className="reconciliation-table bundle-property-table"><thead><tr><th>Property</th><th className="number">Airbnb Payments</th><th className="number">Payment Rows</th><th>Bank Details</th><th>Matched</th><th className="number">Awaiting a Match</th><th><span className="sr-only">View payments</span></th></tr></thead><tbody>{visibleProperties.map(property=>{
    const count=property.payments.length;
    const verified=property.payments.filter(payment=>systemStatus(payment)==='Matched').length;
    const banks=[...new Set(property.payments.map(payment=>payment.bankDetails?.trim()).filter(Boolean))];
    return <tr key={property.id} className="bundle-property-row" onClick={()=>setSelectedId(property.id)}><td><button className="table-property-button" onClick={()=>setSelectedId(property.id)}><strong>{property.name}</strong><span>{property.manager}</span></button></td><td className="number">{money(property.payments.reduce((sum,payment)=>sum+(payment.amountCents??0),0))}</td><td className="number">{count}</td><td>{banks.join(', ')||'Not specified'}</td><td><span className={`status-badge ${count>0&&verified===count?'paid':'partial'}`}>{verified} / {count}</span></td><td className="number">{count-verified}</td><td><button className="icon-button" aria-label={`View payments for ${property.name}`} onClick={()=>setSelectedId(property.id)}><ChevronRight size={17}/></button></td></tr>;
   })}</tbody></table></div>:selectedProperty&&filtered.length?<BundlePaymentTable rows={filtered} onOpen={onOpen}/>:<div className="empty-state compact-empty"><Building2 size={30}/><h3>{selectedProperty?(rows.length?'No matching payments':'No payments for this property'):allProperties.length?'No matching properties':'Start matching your Airbnb deposits'}</h3><p>{rows.length||(!selectedProperty&&allProperties.length)?'Try another search or match status.':'Import an Airbnb Excel or CSV file and leave Expected Amount blank or enter 0.'}</p>{!rows.length&&<button className="button secondary" onClick={onImport}><Upload size={16}/>Import Airbnb Payments</button>}</div>}
   <div className="table-footer"><span>{filtered.length} payment rows · Shared bundles may appear on multiple rows</span><button onClick={onExport}><ArrowDownToLine size={15}/>Export Monthly Workbook</button></div>
  </section>
 </div>;
}

export function BundlePaymentTable({rows,onOpen}:{rows:{property:Property;payment:Payment}[];onOpen:(property:Property)=>void}){
 return <div className="table-scroll"><table className="reconciliation-table"><thead><tr><th>Property</th><th className="number">Airbnb Payment</th><th>Payout Date</th><th className="number">Bundle Amount</th><th>Bank Details</th><th>Bank Date</th><th>System Check</th><th>Daisy Check</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{rows.map(({property,payment})=><tr key={payment.id}><td><button className="table-property-button" onClick={()=>onOpen(property)}><strong>{property.name}</strong><span>{property.manager}</span></button></td><td className="number">{money(payment.amountCents)}</td><td>{payment.payoutDate||'—'}</td><td className="number">{money(payment.bundleCents)}</td><td>{payment.bankDetails||'Not specified'}</td><td>{payment.bankDate||'—'}</td><td><span className={`status-badge ${systemStatus(payment)==='Matched'?'paid':'partial'}`}>{systemStatus(payment)==='Matched'&&<CheckCheck size={14}/>} {systemStatus(payment)}</span></td><td>{payment.verifiedByDaisy?'Verified':'Pending'}</td><td><button className="icon-button" aria-label={`Open ${property.name}`} onClick={()=>onOpen(property)}><ChevronRight size={17}/></button></td></tr>)}</tbody></table></div>;
}
