import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Users, ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, Building2, CalendarDays, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Clock3, ExternalLink, FileSpreadsheet, LayoutDashboard, Loader2, Menu, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload, Wallet, X } from 'lucide-react';
import type { AccountManager, Change, Month, Payment, Property, Snapshot } from './types';
import { balance, collected, money, parseMoney, systemStatus } from './domain';
import { paymentDraftToFields, type PaymentDraft } from './editor';
import BankReport from './BankReport';
import {propertyBanks} from './bank-details.ts';
import {reconciliationRows, type SystemCheckFilter, type DaisyCheckFilter} from './reconciliation-filters.ts';
import { exportWorkbook } from './excel';
import ImportWizard from './ImportWizard';
import BankStatementImport from './BankStatementImport';
import FollowUps from './FollowUps';
import AccountManagers from './AccountManagers';
import ManagerSelect from './ManagerSelect';
import TeamMenu from './TeamMenu';
import WorkflowGuide from './WorkflowGuide';
import UserSettings from './UserSettings';
import { Presence, useExiting } from './Presence';
import { loadPreferences, savePreferences, formatPaymentDate, type Preferences, type View, type StatusFilter } from './preferences';
import './styles.css';
import './property-table.css';
import CastleMark from './CastleMark';
import CastleAssistant from './CastleAssistant';
import type {AssistantRequest,AssistantReply} from './assistant-types';
import CastleWordmark from './CastleWordmark';
import './branding.css';
import {createRecordSync} from './record-sync.ts';
import {loadWorkspaceLocation,saveWorkspaceLocation} from './workspace-location.ts';

type Api = { read: () => Promise<Snapshot>; save: (revision: string, changes: Change[]) => Promise<Snapshot>; assistant?:(request:AssistantRequest,onProgress?:(label:string)=>void)=>Promise<AssistantReply> };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const formatAmount = (amount: number | null) => amount === null ? '' : (amount / 100).toFixed(2);
const hasPayment = (payment: Payment) => payment.amountCents !== null || payment.bundleCents !== null || payment.bankCents !== null;
const propertyStatus = (property: Property) => balance(property) < 0 ? 'Overpaid' : balance(property) === 0 ? 'Collected' : collected(property) > 0 ? "Partially Paid" : 'Unpaid';

export default function App({ api, configured }: { api: Api; configured: boolean }) {
  const [preferences, setPreferences] = useState(loadPreferences);
  const [initialLocation]=useState(()=>loadWorkspaceLocation({view:preferences.defaultView,monthId:'',search:'',manager:preferences.defaultManager,status:preferences.defaultStatus},typeof window==='undefined'?'':window.location.search));
  const [syncError,setSyncError]=useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [readError,setReadError]=useState('');
  const [notice, setNotice] = useState('');
  const [monthId, setMonthId] = useState(initialLocation.monthId);
  const [view, setView] = useState<View>(initialLocation.view);
  const [search, setSearch] = useState(initialLocation.search);
  const [manager, setManager] = useState(initialLocation.manager);
  const [status, setStatus] = useState<StatusFilter>(initialLocation.status);
  const [systemFilter,setSystemFilter]=useState<SystemCheckFilter>('all');
  const [daisyFilter,setDaisyFilter]=useState<DaisyCheckFilter>('all');
  const [selected, setSelected] = useState<Property | null>(null);
  const [adding, setAdding] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bankImportOpen,setBankImportOpen]=useState(false);
  const [assistantImportFile,setAssistantImportFile]=useState<File|undefined>();
  const [mobileNav, setMobileNav] = useState(false);
  const [bankReportOpen,setBankReportOpen]=useState(false);
  const [exporting, setExporting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editRevision, setEditRevision] = useState('');
  const [followUpDirty, setFollowUpDirty] = useState(false);
  const [savingRecords, setSavingRecords] = useState(false);
  const savePending = useRef(false);
  const syncRef=useRef<ReturnType<typeof createRecordSync<Snapshot>>|null>(null);
  const broadcastRef=useRef<BroadcastChannel|null>(null);
  const refreshPaused=followUpDirty||savingRecords||!!selected||adding||importOpen||bankImportOpen||settingsOpen||bankReportOpen;
  const pauseRefresh=()=>syncRef.current?.setPaused(true);
  const followUpEditing = useCallback((editing: boolean) => {
    if(editing)syncRef.current?.setPaused(true);
    setFollowUpDirty(editing);
  }, []);
  const load=useCallback(async()=>{setError('');await syncRef.current?.refresh();},[]);
  useEffect(()=>{
    const sync=createRecordSync<Snapshot>({read:api.read,apply:next=>{setSnapshot(previous=>previous?.revision===next.revision?previous:next);setSyncError('');},loading:setLoading,error:(message,background)=>{if(background)setSyncError(message);else setReadError(message);}});
    syncRef.current=sync;setSnapshot(null);setError('');setReadError('');setSyncError('');void sync.refresh();
    const refresh=()=>{if(document.visibilityState==='visible')void sync.refresh(true);};
    let timer:number|undefined,channel:BroadcastChannel|null=null;
    if(configured){
      timer=window.setInterval(refresh,15000);
      window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);
      try{channel=new BroadcastChannel('castle-records-updated');channel.onmessage=refresh;broadcastRef.current=channel;}catch{/* Polling still works without cross-tab messaging. */}
    }
    return ()=>{sync.dispose();if(timer!==undefined)window.clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);channel?.close();broadcastRef.current=null;};
  },[api,configured]);
  useLayoutEffect(()=>{syncRef.current?.setPaused(refreshPaused);},[refreshPaused]);
  useEffect(()=>{
    saveWorkspaceLocation({view,monthId,search,manager,status});
    const url=new URL(window.location.href);
    if(url.searchParams.has('view')&&url.searchParams.get('view')!==view){url.searchParams.set('view',view);window.history.replaceState(window.history.state,'',url);}
  },[view,monthId,search,manager,status]);
  useEffect(()=>{
    if(snapshot?.months.length&&!snapshot.months.some(m=>m.id===monthId))setMonthId(snapshot.months[0].id);
  },[snapshot,monthId]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6500); return () => window.clearTimeout(timer); }, [notice]);
  const month = snapshot?.months.find(item => item.id === monthId) ?? snapshot?.months[0];
  const properties = month?.properties ?? [];
  const managers = [...new Set(properties.map(property => property.manager).filter(Boolean))].sort();
  const managerRecords = snapshot?.managers ?? [];
  const allManagers = [...new Set(snapshot?.months.flatMap(item => item.properties.map(property => property.manager).filter(Boolean)) ?? [])].sort();
  const shortDate = (date: string) => formatPaymentDate(date, preferences.dateFormat);
  const filtered = properties.filter(property => {
    const matchesSearch = `${property.name} ${property.manager}`.toLowerCase().includes(search.toLowerCase().trim());
    const matchesManager = manager === 'all' || property.manager === manager;
    const matchesStatus = status === 'all' || (status === 'outstanding' && balance(property) > 0) || (status === 'paid' && balance(property) <= 0) || (status === 'unverified' && property.payments.some(payment => hasPayment(payment) && !payment.verifiedByDaisy));
    return matchesSearch && matchesManager && matchesStatus;
  });
  const paymentRows=reconciliationRows(filtered,systemFilter,daisyFilter);
  const total = properties.reduce((sum, property) => sum + property.totalCents, 0);
  const received = properties.reduce((sum, property) => sum + collected(property), 0);
  const outstanding = properties.reduce((sum, property) => sum + balance(property), 0);
  const payments = properties.flatMap(property => property.payments).filter(hasPayment);
  const unverified = payments.filter(payment => !payment.verifiedByDaisy).length;
  const verified = payments.length - unverified;
  const progress = total > 0 ? Math.min(100, Math.max(0, Math.round(received / total * 100))) : 0;
  const channelTotals = (['Airbnb', 'Vrbo', 'Owner'] as const).map(type => ({ type, cents: properties.reduce((sum, property) => sum + property.payments.filter(payment => payment.type === type).reduce((subtotal, payment) => subtotal + (payment.amountCents ?? 0), 0), 0) }));

  async function applyChanges(changes: Change[]) {
    if (!snapshot) throw new Error('Wait for your records to load before saving.');
    await saveChanges(editRevision || snapshot.revision, changes);
  }
  async function saveChanges(revision: string, changes: Change[]) {
    if (savePending.current) throw new Error('Another save is in progress. Please wait.');
    if (snapshot?.managerSchema !== 1 && changes.some(c => ['deleteManager','saveManager','saveTask','addManagerUpdate','updateFollowUp','addProperty'].includes(c.kind))) throw new Error('Update the Apps Script deployment before saving manager assignments or records.');
    if(snapshot?.bankDetailsSchema!==1&&changes.some(c=>c.kind==='updatePayment'?c.fields.bankDetails!==undefined:c.kind==='appendPayments'?c.payments.some(p=>p.bankDetails!==undefined):c.kind==='addProperty'?[...(c.initialPayments??[]),...(c.additionalPayments??[])].some(p=>p.bankDetails!==undefined):false))throw new Error('Update the Apps Script deployment before importing bank details.');
    if(snapshot?.recordEditingSchema!==1&&changes.some(c=>['updateProperty','deleteProperty','deletePayment'].includes(c.kind)||(c.kind==='updatePayment'&&c.fields.type!==undefined)))throw new Error('Update the Apps Script deployment before editing or deleting records.');
    savePending.current = true; setSavingRecords(true);
    pauseRefresh();
    try {
      const next = await api.save(revision, changes);
      syncRef.current?.acceptSaved(next);
      try{broadcastRef.current?.postMessage({revision:next.revision});}catch{/* Other tabs still refresh on their timer. */}
      setNotice(configured ? 'Changes saved to Google Sheets.' : 'Preview updated. Changes reset when you reload this page.');
    } finally { savePending.current = false; setSavingRecords(false); }
  }
  function openProperty(property: Property) { pauseRefresh(); setEditRevision(snapshot?.revision ?? ''); setSelected(property); }
  function openBankImport() { setAssistantImportFile(undefined);pauseRefresh(); setEditRevision(snapshot?.revision ?? ''); setBankImportOpen(true); }
  function openImport() { setAssistantImportFile(undefined);pauseRefresh(); setEditRevision(snapshot?.revision ?? ''); setImportOpen(true); }
  function navigate(next: View) { if (followUpDirty || savingRecords) return; setView(next); setSystemFilter('all'); setDaisyFilter('all'); setMobileNav(false); setStatus(preferences.defaultStatus); setSearch(''); }
  function updatePreferences(next: Preferences) {
    const persisted = savePreferences(next);
    setPreferences(next);
    setView(next.defaultView);
    setManager(next.defaultManager);
    setStatus(next.defaultStatus);
    setSearch('');
    setSettingsOpen(false);
    setNotice(persisted ? 'Your preferences are saved in this browser.' : 'Preferences applied for this session. Your browser could not save them.');
  }
  async function download() {
    if (!snapshot || !month) return;
    setExporting(true); setError('');
    try { await exportWorkbook(snapshot, month.id); setNotice('Monthly workbook downloaded.'); }
    catch (e) { setError(errorText(e)); }
    finally { setExporting(false); }
  }

  return <div className="app-shell" data-density={preferences.density}>
    <Presence present={mobileNav}>{exiting => <button className="nav-scrim" data-exiting={exiting} aria-label="Close navigation" onClick={() => setMobileNav(false)} disabled={exiting} />}</Presence>
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
      <a className="brand" href="#overview" onClick={event => { event.preventDefault(); navigate('overview'); }} aria-label="Castle Overview"><CastleWordmark/></a>
      <div className="workspace"><span className="workspace-icon"><Building2 size={18} /></span><span><strong>Castle Portfolio</strong><small>Monthly Accounts Receivable</small></span><span className="workspace-dot" /></div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation" inert={followUpDirty || savingRecords}>
        <button className={view === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('overview')}><LayoutDashboard size={19} /><span>Overview</span>{view === 'overview' && <span className="nav-active-dot" />}</button>
        <button className={view === 'properties' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('properties')}><Building2 size={19} /><span>Follow-Ups</span><span className="nav-count">{properties.length}</span></button>
        <button className={view === 'reconciliation' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('reconciliation')}><ClipboardCheck size={19} /><span>Reconciliation</span>{unverified > 0 && <span className="nav-count">{unverified}</span>}</button>
        <button className={view === 'managers' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('managers')}><Users size={19}/><span>Account Managers</span></button>
      </nav>
      <div style={{ marginTop: 'auto' }} inert={followUpDirty || savingRecords}><TeamMenu onSettings={() => setSettingsOpen(true)} onHelp={() => setHelpOpen(true)} /></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}><Menu size={22} /></button><span>Workspace</span><ChevronRight size={14} /><strong>{view === 'managers' ? "Account Managers" : view === 'overview' ? 'Overview' : view === 'properties' ? "Follow-Ups" : 'Reconciliation'}</strong></div><div className="topbar-right"><span className={`connection-indicator ${configured ? 'connected' : ''}`}><span />{configured ? 'Google Sheets Connected · Auto-Refresh On' : "Preview Workspace"}</span><span className="topbar-divider" /><span className="top-avatar" title="Shared Castle Workspace"><CastleMark/></span></div></header>
      <main>
        {!configured && <div className="preview-banner"><span><FileSpreadsheet size={16} /><strong>Preview Data</strong><span className="preview-copy"> · contact your workspace administrator for shared records</span></span></div>}
        <section className="page-heading"><div><div className="eyebrow">YOUR PORTFOLIO, AT A GLANCE</div><h1>{view === 'managers' ? "Account Managers" : view === 'overview' ? "Monthly Overview" : view === 'properties' ? "Property Follow-Ups" : "Payment Reconciliation"}</h1><p>{view === 'managers' ? 'One place for assigned listings, tasks, and team updates.' : view === 'overview' ? 'A clear picture of what’s collected and what’s coming in.' : view === 'properties' ? 'Track owner conversations, assign managers, and keep the next step clear.' : 'Match bank deposits and review your monthly payments.'}</p></div><div className="heading-actions"><div className="month-select"><CalendarDays size={17} /><select aria-label="Reporting Month" value={month?.id ?? ''} disabled={!snapshot?.months.length || followUpDirty || savingRecords} onChange={event => { setMonthId(event.target.value); setManager(preferences.defaultManager); setStatus(preferences.defaultStatus); setSearch(''); }}>{snapshot?.months.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}{!snapshot?.months.length && <option value="">Reporting Month</option>}</select><ChevronDown size={14} /></div><button className="icon-button sync-button" onClick={() => void load()} disabled={loading || refreshPaused} aria-label="Refresh Records" title="Refresh Records"><RefreshCw size={18} className={loading ? 'spin' : ''} /></button></div></section>
        {syncError&&<div className="error-banner" role="status"><span>Automatic refresh could not connect. Showing your last loaded data; retrying automatically.</span><button disabled={refreshPaused||loading} onClick={()=>void load()}>Retry <RefreshCw size={14}/></button></div>}
        {(error||readError) && <div className="error-banner" role="alert"><span>{error||readError}</span><button disabled={followUpDirty || savingRecords} onClick={() => void load()}>Retry <RefreshCw size={14} /></button></div>}
        {loading && !snapshot ? <div className="loading-state" role="status"><Loader2 size={28} className="spin" /><h2>Loading your portfolio</h2><p>Getting the latest monthly records…</p></div> : !snapshot ? <div className="empty-state"><FileSpreadsheet size={34} /><h2>Your records couldn’t be loaded</h2><p>Check your connection and try again.</p><button className="button primary" onClick={() => void load()}>Try again</button><p>If this continues, contact your workspace administrator.</p></div> : view === 'managers' ? <AccountManagers snapshot={snapshot} monthId={month?.id??''} onDirtyChange={followUpEditing} onSave={(revision,change)=>saveChanges(revision,[change])} onOpenListing={(id,property)=>{setMonthId(id);setManager('all');setStatus('all');setSearch(property.name);setView('properties');}}/> : !month ? <div className="empty-state"><CalendarDays size={34} /><h2>No monthly records yet</h2><p>Add a monthly tab in your connected Google Sheet, then refresh.</p><button className="button secondary" onClick={() => void load()}><RefreshCw size={16} />Refresh Records</button></div> : <>
          <section className="metrics" aria-label="Monthly Totals">
            <Metric title="Total Expected" value={money(total)} detail={`${properties.length} ${properties.length === 1 ? 'property' : 'properties'} this month`} icon={<Wallet size={19} />} />
            <Metric title="Amount Collected" value={money(received)} detail={`${progress}% of expected amount`} icon={<ArrowDownLeft size={20} />} tone="green" adornment={<span className="metric-mini-bar"><span style={{ width: `${progress}%` }} /></span>} />
            <Metric title="Outstanding Balance" value={money(outstanding)} detail={`${properties.filter(property => balance(property) > 0).length} properties with a balance`} icon={<Clock3 size={19} />} tone="amber" />
            <Metric title="Awaiting Verification" value={String(unverified).padStart(2, '0')} detail={`${verified} of ${payments.length} payments verified by Daisy`} icon={<ShieldCheck size={19} />} tone="blue" adornment={<span className="metric-caption">PAYMENTS</span>} />
          </section>
          <div className={`content-layout ${view !== 'overview' ? 'full-width' : ''}`}>
            <section className="records-panel panel">
              <div className="panel-heading"><div><h2>{view === 'reconciliation' ? "Payment Register" : view === 'properties' ? "Owner Follow-Ups" : "Property Overview"}<span className="count-pill">{properties.length}</span></h2><p>{view === 'reconciliation' ? 'Compare payout bundles with bank deposits.' : view === 'properties' ? 'Update the status, notes, and manager for each property.' : `Track collections across your ${month.label} portfolio.`}</p></div><div className="panel-actions" inert={followUpDirty || savingRecords}><button className="button secondary compact" onClick={openImport}><Upload size={15} /><span>Import Excel</span></button><button className="button primary compact" onClick={openBankImport}><Upload size={16} /><span>Import Bank Statement</span></button></div></div>
              <div className="record-tabs" inert={followUpDirty || savingRecords} aria-label="Filter property records"><button className={status === 'all' ? 'selected' : ''} onClick={() => setStatus('all')}>All Properties <span>{properties.length}</span></button><button className={status === 'outstanding' ? 'selected' : ''} onClick={() => setStatus('outstanding')}>Outstanding <span>{properties.filter(property => balance(property) > 0).length}</span></button><button className={status === 'paid' ? 'selected' : ''} onClick={() => setStatus('paid')}>Collected</button>{view === 'reconciliation' && <span className="payment-row-count" role="status">{paymentRows.length} payment rows</span>}</div>
              <div className={view === 'reconciliation' ? 'filter-row reconciliation-filter-row' : 'filter-row'} inert={followUpDirty || savingRecords}><label className="search-field"><Search size={17} /><input type="search" placeholder="Search properties…" aria-label="Search properties" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="select-field"><select aria-label="Filter by manager" value={manager} onChange={event => setManager(event.target.value)}><option value="all">All Managers</option>{manager !== 'all' && !managers.includes(manager) && <option value={manager}>{manager} (no records this month)</option>}{managers.map(item => <option key={item} value={item}>{item}</option>)}</select><ChevronDown size={14} /></div><div className="select-field status-select"><select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value as StatusFilter)}><option value="all">All Statuses</option><option value="outstanding">Outstanding</option><option value="paid">Collected</option><option value="unverified">Needs Verification</option></select><ChevronDown size={14} /></div>{view === 'reconciliation' && <><div className="select-field"><select aria-label="Filter by system check" value={systemFilter} onChange={e=>setSystemFilter(e.target.value as SystemCheckFilter)}><option value="all">System: All</option><option value="Matched">System: Matched</option><option value="Mismatch">System: Mismatch</option><option value="Pending">System: Pending</option></select><ChevronDown size={14}/></div><div className="select-field"><select aria-label="Filter by Daisy check" value={daisyFilter} onChange={e=>setDaisyFilter(e.target.value as DaisyCheckFilter)}><option value="all">Daisy: All</option><option value="verified">Daisy: Verified</option><option value="pending">Daisy: Pending</option></select><ChevronDown size={14}/></div></>}</div>
              {view === 'properties' ? <div inert={loading} aria-busy={loading}><FollowUps key={month.id} properties={filtered} managers={managerRecords} onManageManagers={()=>navigate('managers')} revision={snapshot.revision} onDirtyChange={followUpEditing} onOpen={openProperty} onSave={async (revision, change) => { await saveChanges(revision, [change]); }} /></div> : (filtered.length === 0 || (view === 'reconciliation' && paymentRows.length === 0)) ? <div className="empty-state compact-empty"><Search size={28} /><h3>{properties.length ? 'No matching properties' : 'Your first property starts here'}</h3><p>{properties.length ? 'Try a different search or clear your filters.' : 'Import an Excel file to start tracking monthly collections.'}</p><button className="button secondary" onClick={() => { if (!properties.length) openImport(); else { setSearch(''); setManager('all'); setStatus('all'); setSystemFilter('all'); setDaisyFilter('all'); } }}>{properties.length ? "Clear Filters" : "Import Excel"}</button></div> : view === 'reconciliation' ? <div className="table-scroll"><table className="reconciliation-table"><thead><tr><th>Property / payment</th><th className="number">Received</th><th>Payout Date</th><th className="number">Bundle</th><th className="number">Bank Deposit</th><th>System Check</th><th>Daisy Check</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{paymentRows.map(({property,payment,index}) => <tr key={payment.id}><td><button className="table-property-button" onClick={() => openProperty(property)}><strong>{property.name}</strong><span>{payment.type} {payment.type === 'Airbnb' ? index + 1 : ''}</span></button></td><td className="number">{money(payment.amountCents)}</td><td>{shortDate(payment.payoutDate)}</td><td className="number">{money(payment.bundleCents)}</td><td className="number">{money(payment.bankCents)}</td><td><SystemBadge payment={payment} /></td><td><span className={`verification-label ${payment.verifiedByDaisy ? 'verified' : ''}`}>{payment.verifiedByDaisy ? <CheckCheck size={14} /> : <Clock3 size={14} />}{payment.verifiedByDaisy ? 'Verified' : 'Pending'}</span></td><td><button className="icon-button" onClick={() => openProperty(property)} aria-label={`Edit ${property.name} payments`}><ChevronRight size={17} /></button></td></tr>)}</tbody></table></div> : <>
                <div className="table-scroll property-table-wrap"><table className="property-table"><colgroup><col className="property-column"/><col className="amount-column"/><col className="amount-column"/><col className="amount-column"/><col className="bank-column"/><col className="status-column"/><col className="action-column"/></colgroup><thead><tr><th>Property</th><th className="number">Expected</th><th className="number">Collected</th><th className="number">Outstanding</th><th>Bank Details</th><th>Status</th><th><span className="sr-only">Open property</span></th></tr></thead><tbody>{filtered.map((property, index) => <tr key={property.id}><td><button className="property-name-cell" title={property.name} onClick={() => openProperty(property)}><span className={`property-icon tint-${index % 3}`}><Building2 size={21} strokeWidth={1.6} /></span><span><strong>{property.name}</strong><small>{property.manager || 'No manager assigned'}</small></span></button></td><td className="number">{money(property.totalCents)}</td><td className="number collected-cell">{money(collected(property))}</td><td className="number balance-cell">{money(balance(property))}</td><td className="bank-details-cell" title={propertyBanks(property).join(', ') || 'Not Specified'}>{propertyBanks(property).join(', ') || 'Not Specified'}</td><td><span className={`status-badge ${balance(property) <= 0 ? 'paid' : collected(property) > 0 ? 'partial' : 'unpaid'}`}><span />{propertyStatus(property)}</span></td><td><button className="icon-button row-open" onClick={() => openProperty(property)} aria-label={`Open ${property.name}`}><ChevronRight size={17} /></button></td></tr>)}</tbody><tfoot><tr><td>Portfolio Total</td><td className="number">{money(filtered.reduce((sum, property) => sum + property.totalCents, 0))}</td><td className="number collected-cell">{money(filtered.reduce((sum, property) => sum + collected(property), 0))}</td><td className="number balance-cell">{money(filtered.reduce((sum, property) => sum + balance(property), 0))}</td><td colSpan={3} /></tr></tfoot></table></div>
                <div className="property-mobile-list">{filtered.map((property, index) => <button className="property-mobile-card" key={property.id} onClick={() => openProperty(property)}><div className="mobile-property-heading"><span className={`property-icon tint-${index % 3}`}><Building2 size={20} /></span><span><strong>{property.name}</strong><small>{property.manager || 'No manager assigned'}</small></span><ChevronRight size={18} /></div><div className="mobile-property-amounts"><span><small>Expected</small><strong>{money(property.totalCents)}</strong></span><span><small>Collected</small><strong className="collected-cell">{money(collected(property))}</strong></span><span><small>Outstanding</small><strong>{money(balance(property))}</strong></span></div><p className="mobile-bank-details"><strong>Bank Details</strong> {propertyBanks(property).join(', ') || 'Not Specified'}</p><span className={`status-badge ${balance(property) <= 0 ? 'paid' : 'partial'}`}><span />{propertyStatus(property)}</span></button>)}</div>
              </>}
              <div className="table-footer"><span>Showing {filtered.length} of {properties.length} properties</span><button onClick={()=>{pauseRefresh();setBankReportOpen(true);}}><ArrowDownToLine size={15}/>Bank Report</button><button onClick={() => void download()} disabled={exporting}><ArrowDownToLine size={15} />{exporting ? 'Exporting…' : "Export Workbook"}</button></div>
            </section>
            {view === 'overview' && <aside className="summary-column">
              <section className="panel collection-panel"><div className="section-title"><h2>Collection Progress</h2><span className="subtle-icon"><Wallet size={17} /></span></div><div className="progress-donut" style={{ background: `conic-gradient(var(--green) 0% ${progress}%, #e5e7eb ${progress}% 100%)` }} role="img" aria-label={`${progress}% of expected amount collected`}><div><strong>{progress}<span>%</span></strong><small>collected</small></div></div><div className="progress-legend"><div><span><i className="legend-dot green" />Collected</span><strong>{money(received)}</strong></div><div><span><i className="legend-dot gray" />Outstanding</span><strong>{money(outstanding)}</strong></div></div><div className="collection-note"><span className="note-icon"><ArrowUpRight size={16} /></span><p>{progress >= 100 ? 'Your expected amount is fully collected.' : <><strong>{money(outstanding)}</strong> left to collect this month.</>}</p></div></section>
              <section className="panel channel-panel"><h2>Payment Sources</h2><p>Collected by channel</p><div className="channel-stack">{channelTotals.map(channel => <div className="channel-row" key={channel.type}><span className={`channel-icon ${channel.type.toLowerCase()}`}>{channel.type === 'Airbnb' ? 'A' : channel.type === 'Vrbo' ? 'V' : <Building2 size={16} />}</span><div><span>{channel.type}</span><div className="channel-bar"><span style={{ width: `${received > 0 ? Math.max(0, channel.cents / received * 100) : 0}%` }} /></div></div><strong>{money(channel.cents)}</strong></div>)}</div></section>
            </aside>}
          </div>
          {view === 'overview' && <section className="review-callout"><span className="review-icon"><ClipboardCheck size={24} /></span><div><h3>{unverified ? 'A little review goes a long way.' : 'Keep every payment accounted for.'}</h3><p>{unverified ? `${unverified} payments are waiting for Daisy’s verification. Review payout and bank details to close the loop.` : 'Use reconciliation to match payout bundles to bank deposits and verify your records.'}</p></div><button className="button secondary" onClick={() => { setView('reconciliation'); setStatus('unverified'); }}>Review Payments<ArrowRight size={16} /></button></section>}
          <footer className="page-footer"><span><span className={`footer-dot ${configured ? 'live' : ''}`} />{configured ? 'Shared Google Sheets records' : 'Temporary preview · changes reset on reload'}</span><span>{snapshot.updatedAt ? `Records updated ${new Date(snapshot.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Ready to review'}{snapshot.spreadsheetUrl && <a href={snapshot.spreadsheetUrl} target="_blank" rel="noreferrer">Open Spreadsheet<ExternalLink size={12} /></a>}</span></footer>
        </>}
      </main>
      {snapshot && <CastleAssistant snapshot={snapshot} monthId={monthId} ask={configured?api.assistant:undefined} onApply={saveChanges} onImport={(kind,file,targetMonth)=>{setMonthId(targetMonth);if(kind==='bank')openBankImport();else openImport();setAssistantImportFile(file);}}/>}
    </div>
    <Presence present={!!notice}>{exiting => <div className="toast" role="status" data-exiting={exiting} inert={exiting}><CheckCircle2 size={18} />{notice}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}</Presence>
    <Presence present={!!selected}>{selected && <PropertyDrawer managers={managerRecords} editingSupported={snapshot?.recordEditingSchema===1} key={selected.id} property={selected} monthLabel={month?.label ?? ''} configured={configured} onClose={() => setSelected(null)} onSave={async changes => { await applyChanges(changes); setSelected(null); }} />}</Presence>
    <Presence present={adding && !!month}>{adding && month && <AddProperty managers={managerRecords} onManageManagers={()=>{setAdding(false);navigate('managers');}} month={month} onClose={() => setAdding(false)} onSave={async changes => { await applyChanges(changes); setAdding(false); }} />}</Presence>
    {bankImportOpen && month && <BankStatementImport initialFile={assistantImportFile} month={month} supported={(snapshot?.bankStatementSchema??0)>=2} onClose={()=>setBankImportOpen(false)} onApply={async changes=>{await applyChanges(changes);setBankImportOpen(false);}}/>}
    <Presence present={importOpen && !!month}>{importOpen && month && <ImportWizard initialFile={assistantImportFile} managers={managerRecords} onManageManagers={()=>{setImportOpen(false);navigate('managers');}} month={month} propertyCatalog={snapshot?.months.flatMap(item => item.properties)} onClose={() => setImportOpen(false)} onApply={async changes => { await applyChanges(changes); setImportOpen(false); }} />}</Presence>
    <Presence present={bankReportOpen}>{bankReportOpen&&snapshot&&month&&<BankReport snapshot={snapshot} monthId={month.id} onClose={()=>setBankReportOpen(false)}/>}</Presence>
    <Presence present={helpOpen}>{helpOpen && <Dialog title="Your Monthly AR Workflow" className="workflow-dialog" onClose={() => setHelpOpen(false)}><WorkflowGuide /></Dialog>}</Presence>
    <Presence present={settingsOpen}>{settingsOpen && <Dialog title="User Settings" className="settings-dialog" onClose={() => setSettingsOpen(false)}><UserSettings preferences={preferences} managers={allManagers} onSave={updatePreferences} onCancel={() => setSettingsOpen(false)} /></Dialog>}</Presence>
  </div>;
}

function Metric({ title, value, detail, icon, tone = 'neutral', adornment }: { title: string; value: string; detail: string; icon: ReactNode; tone?: string; adornment?: ReactNode }) {
  return <article className={`metric-card ${tone}`}><div className="metric-header"><span>{title}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{value}{adornment}</div><div className="metric-detail">{detail}</div></article>;
}
function SystemBadge({ payment }: { payment: Payment }) { const status = systemStatus(payment); return <span className={`system-badge ${status.toLowerCase()}`}>{status === 'Matched' ? <Check size={12} /> : status === 'Mismatch' ? <X size={12} /> : <Clock3 size={12} />}{status}</span>; }

export function Dialog({ title, onClose, children, className = '', busy = false, subtitle }: { title: string; onClose: () => void; children: ReactNode; className?: string; busy?: boolean; subtitle?: string }) {
  const exiting = useExiting();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    if (!exiting) return;
    // Inert contents can release focus to the page. Keep keyboard actions
    // blocked, like backdrop clicks, until the closing dialog is removed.
    function blockKeys(event: KeyboardEvent) { event.preventDefault(); event.stopImmediatePropagation(); }
    document.addEventListener('keydown', blockKeys, true);
    return () => document.removeEventListener('keydown', blockKeys, true);
  }, [exiting]);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => { document.body.style.overflow = overflow; prior?.focus(); };
  }, []);
  function onKeyDown(event: React.KeyboardEvent) {
    if (exiting) { event.preventDefault(); event.stopPropagation(); return; }
    // Let an open native picker handle Escape before dismissing its dialog.
    const target = event.target instanceof Element ? event.target.closest('select') : null;
    if (event.key === 'Escape' && CSS.supports('selector(select:open)') && target?.matches(':open')) {
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); close.current(); }
    if (event.key !== 'Tab') return;
    const focusable = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
    if (!focusable?.length) { event.preventDefault(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
  }
  return <div className={`modal-backdrop ${className === 'drawer' ? 'drawer-backdrop' : ''}`} data-exiting={exiting} onMouseDown={event => { if (event.target === event.currentTarget && !busy && !exiting) onClose(); }}><div className={`dialog ${className}`} ref={ref} inert={exiting} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}><div className="dialog-header"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy || exiting}><X size={21} /></button></div>{children}</div></div>;
}

function PropertyDrawer({ property, monthLabel, configured, managers, editingSupported, onClose, onSave }: { managers:AccountManager[]; editingSupported:boolean; property: Property; monthLabel: string; configured: boolean; onClose: () => void; onSave: (changes: Change[]) => Promise<void> }) {
  const [name,setName]=useState(property.name),[assignedManager,setAssignedManager]=useState(property.manager);
  const [total, setTotal] = useState(formatAmount(property.totalCents));
  const initialDrafts = useMemo(() => Object.fromEntries(property.payments.map(payment => [payment.id, { type:payment.type, bankDetails:payment.bankDetails??'', amount: formatAmount(payment.amountCents), payoutDate: payment.payoutDate, bundle: formatAmount(payment.bundleCents), bankDate: payment.bankDate, bank: formatAmount(payment.bankCents), verifiedByDaisy: payment.verifiedByDaisy }])), [property]);
  const [drafts, setDrafts] = useState<Record<string, PaymentDraft>>(initialDrafts);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = name !== property.name || assignedManager !== property.manager || total !== formatAmount(property.totalCents) || JSON.stringify(drafts) !== JSON.stringify(initialDrafts);
  const previewCollected = Object.values(drafts).reduce((sum, draft) => { try { return sum + (parseMoney(draft.amount) ?? 0); } catch { return sum; } }, 0);
  let previewTotal = property.totalCents;
  try { previewTotal = parseMoney(total) ?? 0; } catch { /* Keep last valid total in summary while editing. */ }
  function update(id: string, field: keyof PaymentDraft, value: string | boolean) { setDrafts(current => ({ ...current, [id]: { ...current[id], [field]: value } })); }
  function close() { if (!dirty || window.confirm('Discard your unsaved changes to this property?')) onClose(); }
  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const amount = parseMoney(total);
      if (amount === null || amount < 0) throw new Error('Enter an expected amount of zero or more.');
      const changes: Change[] = [];
      if(!name.trim())throw new Error('Enter a property name.');
      if(name.trim()!==property.name||assignedManager!==property.manager)changes.push({kind:'updateProperty',propertyId:property.id,name:name.trim(),manager:assignedManager});
      if (amount !== property.totalCents) changes.push({ kind: 'setTotal', propertyId: property.id, amountCents: amount });
      for (const payment of property.payments) {
        const fields = paymentDraftToFields(payment, drafts[payment.id]);
        if (Object.keys(fields).length) changes.push({ kind: 'updatePayment', paymentId: payment.id, fields });
      }
      if (!changes.length) { onClose(); return; }
      setSaving(true); await onSave(changes);
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  }
  async function remove(payment?:Payment){
    const description=payment ? 'this '+payment.type+' payment row' : '�'+property.name+'� and all '+property.payments.length+' payment rows in '+monthLabel;
    if(!window.confirm('Delete '+description+'? This removes the record from '+(configured?'Google Sheets':'the local preview')+'.'+(dirty?' Unsaved edits will be discarded.':'')))return;
    setSaving(true);setError('');try{await onSave([payment?{kind:'deletePayment',paymentId:payment.id}:{kind:'deleteProperty',propertyId:property.id}]);}catch(e){setError(errorText(e));}finally{setSaving(false);}
  }
  return <Dialog title={property.name} subtitle={`${property.manager || 'No manager'} · ${monthLabel}`} className="drawer" onClose={close} busy={saving}><form className="drawer-form" onSubmit={save}><div className="drawer-content">{!editingSupported&&<p className="field-help">Update the Apps Script deployment to enable property editing and record deletion.</p>}<div className="record-property-fields"><label>Property Name<input aria-label="Property name" value={name} onChange={e=>setName(e.target.value)} maxLength={160} disabled={saving||!editingSupported} required/></label><label>Account Manager<ManagerSelect managers={managers} value={assignedManager} currentValue={property.manager} onChange={setAssignedManager} disabled={saving||!editingSupported}/></label></div><div className="drawer-summary"><label>Expected Amount<input aria-label="Property expected amount" inputMode="decimal" value={total} onChange={event => setTotal(event.target.value)} required disabled={saving} /></label><div><span>Collected</span><strong className="collected-cell">{money(previewCollected)}</strong></div><div><span>Outstanding</span><strong>{money(previewTotal - previewCollected)}</strong></div></div><div className="drawer-section-heading"><h3>Payment Details</h3><span>{property.payments.length} payment rows</span></div><p className="field-help">Enter amounts using a decimal point. A blank amount clears that field; zero records a zero payment.</p><div className="payment-cards">{property.payments.map((payment, index) => {
    const draft = drafts[payment.id];
    let preview = payment;
    try { preview = { ...payment, ...paymentDraftToFields(payment,draft) }; if(Object.keys(paymentDraftToFields(payment,draft)).some(key=>key!=='verifiedByDaisy'))preview.verifiedBySystem=false; } catch { /* Invalid input is explained when saving. */ }
    return <fieldset className="payment-card" key={payment.id} disabled={saving}><legend><span className={`channel-icon ${payment.type.toLowerCase()}`}>{payment.type === 'Airbnb' ? 'A' : payment.type === 'Vrbo' ? 'V' : <Building2 size={14} />}</span>{payment.type}{payment.type === 'Airbnb' && <span className="payment-sequence">Payment {index + 1}</span>}</legend><div className="payment-field-grid"><label>Payment Type<select aria-label={`Payment ${index+1} type`} value={draft.type} onChange={e=>update(payment.id,'type',e.target.value)} disabled={!editingSupported}><option>Airbnb</option><option>Vrbo</option><option>Owner</option></select></label><label>Payment Amount<input aria-label={`${payment.type} ${index + 1} payment amount`} inputMode="decimal" placeholder="0.00" value={draft.amount} onChange={event => update(payment.id, 'amount', event.target.value)} /></label><label>Payout Date<input type="date" value={draft.payoutDate} onChange={event => update(payment.id, 'payoutDate', event.target.value)} /></label><label>Bundle Amount<input inputMode="decimal" placeholder="Not entered" value={draft.bundle} onChange={event => update(payment.id, 'bundle', event.target.value)} /></label><label>Bank Details<input type="text" aria-label={`Payment ${index+1} bank details`} value={draft.bankDetails??''} placeholder="e.g. Checking 5864" onChange={e=>update(payment.id,'bankDetails',e.target.value)}/></label><label>Bank Amount<input inputMode="decimal" placeholder="Not entered" value={draft.bank} onChange={event => update(payment.id, 'bank', event.target.value)} /></label><label>Bank Date<input type="date" value={draft.bankDate} onChange={event => update(payment.id, 'bankDate', event.target.value)} /></label><div className="system-field"><span>System Verification</span><SystemBadge payment={preview} /></div></div><div className="payment-card-footer"><label className="verification-checkbox"><input type="checkbox" checked={draft.verifiedByDaisy} onChange={event => update(payment.id, 'verifiedByDaisy', event.target.checked)} /><span>Verified by Daisy</span><ShieldCheck size={15} /></label><button type="button" className="button danger compact payment-delete" onClick={()=>void remove(payment)} disabled={saving||!editingSupported}><Trash2 size={15}/>Delete Payment</button></div></fieldset>;
  })}</div><div className="drawer-info"><ShieldCheck size={18} /><p>System verification reflects bank matching. Editing payment evidence clears prior verification. Daisy’s verification records a separate manual review.</p></div></div><div className="drawer-footer">{error && <div className="form-error" role="alert">{error}</div>}<div className="drawer-footer-actions"><button type="button" className="button danger compact" onClick={()=>void remove()} disabled={saving||!editingSupported}><Trash2 size={15}/>Delete Property</button><span>{configured ? 'Saved to your shared Google Sheet' : 'Temporary preview · resets on reload'}</span><button type="button" className="button secondary" onClick={close} disabled={saving}>Cancel</button><button type="submit" className="button primary" disabled={saving || !dirty}>{saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}{saving ? 'Saving…' : "Save Changes"}</button></div></div></form></Dialog>;
}

function AddProperty({ month, managers, onManageManagers, onClose, onSave }: { managers: AccountManager[]; onManageManagers:()=>void; month: Month; onClose: () => void; onSave: (changes: Change[]) => Promise<void> }) {
  const [name, setName] = useState(''); const [manager, setManager] = useState(''); const [amount, setAmount] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      if (!name.trim()) throw new Error('Enter a property name.');
      if (!managers.some(m=>m.active&&m.name===manager)) throw new Error('Choose a registered account manager.');
      if (month.properties.some(property => property.name.trim().toLowerCase() === name.trim().toLowerCase())) throw new Error('This property already exists in the selected month.');
      const total = parseMoney(amount); if (total === null || total < 0) throw new Error('Enter an expected amount of zero or more.');
      setSaving(true); await onSave([{ kind: 'addProperty', monthId: month.id, name: name.trim(), manager: manager.trim(), totalCents: total }]);
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  }
  return <Dialog title="Add a Property" subtitle={`Create a monthly record for ${month.label}`} onClose={onClose} busy={saving}><form onSubmit={submit} className="add-form"><label>Property Name<input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Castle Beach House" maxLength={120} required disabled={saving} /></label><label>Property Manager (Required)<ManagerSelect managers={managers} required value={manager} onChange={setManager} disabled={saving}/><small>Select a saved manager record.</small></label><button type="button" className="button quiet compact" disabled={saving} onClick={()=>{if(!(name||amount||manager)||window.confirm('Opening account managers will discard this unsaved property form. Continue?'))onManageManagers();}}>Manage Account Managers</button><label>Expected Amount<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" required disabled={saving} /></label><p className="field-help">Your property starts with Total Payment and AR rows. Payment rows are added only when you import payment data.</p>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}{saving ? 'Adding…' : "Add Property"}</button></div></form></Dialog>;
}
