import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, Building2, CalendarDays, Castle, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Clock3, ExternalLink, FileSpreadsheet, LayoutDashboard, Loader2, Menu, Plus, RefreshCw, Search, ShieldCheck, Upload, Wallet, X } from 'lucide-react';
import type { Change, Month, Payment, Property, Snapshot } from './types';
import { balance, collected, money, parseMoney, systemStatus } from './domain';
import { paymentDraftToFields, type PaymentDraft } from './editor';
import { exportWorkbook } from './excel';
import ImportWizard from './ImportWizard';
import TeamMenu from './TeamMenu';
import WorkflowGuide from './WorkflowGuide';
import './styles.css';

type Api = { read: () => Promise<Snapshot>; save: (revision: string, changes: Change[]) => Promise<Snapshot> };
type View = 'overview' | 'properties' | 'reconciliation';
type StatusFilter = 'all' | 'outstanding' | 'paid' | 'unverified';
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const formatAmount = (amount: number | null) => amount === null ? '' : (amount / 100).toFixed(2);
const hasPayment = (payment: Payment) => payment.amountCents !== null || payment.bundleCents !== null || payment.bankCents !== null;
const propertyStatus = (property: Property) => balance(property) < 0 ? 'Overpaid' : balance(property) === 0 ? 'Collected' : collected(property) > 0 ? 'Partially paid' : 'Unpaid';
const shortDate = (date: string) => { if (!date) return '—'; const d = new Date(`${date}T12:00:00`); return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };

export default function App({ api, configured, onConfigure }: { api: Api; configured: boolean; onConfigure: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [monthId, setMonthId] = useState('');
  const [view, setView] = useState<View>('overview');
  const [search, setSearch] = useState('');
  const [manager, setManager] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Property | null>(null);
  const [adding, setAdding] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editRevision, setEditRevision] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true); setError('');
    try { const next = await api.read(); if (sequence === request.current) setSnapshot(next); }
    catch (e) { if (sequence === request.current) setError(errorText(e)); }
    finally { if (sequence === request.current) setLoading(false); }
  }, [api]);
  useEffect(() => { setSnapshot(null); void load(); return () => { request.current += 1; }; }, [load]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6500); return () => window.clearTimeout(timer); }, [notice]);
  const month = snapshot?.months.find(item => item.id === monthId) ?? snapshot?.months[0];
  const properties = month?.properties ?? [];
  const managers = [...new Set(properties.map(property => property.manager).filter(Boolean))].sort();
  const filtered = properties.filter(property => {
    const matchesSearch = `${property.name} ${property.manager}`.toLowerCase().includes(search.toLowerCase().trim());
    const matchesManager = manager === 'all' || property.manager === manager;
    const matchesStatus = status === 'all' || (status === 'outstanding' && balance(property) > 0) || (status === 'paid' && balance(property) <= 0) || (status === 'unverified' && property.payments.some(payment => hasPayment(payment) && !payment.verifiedByDaisy));
    return matchesSearch && matchesManager && matchesStatus;
  });
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
    const next = await api.save(editRevision || snapshot.revision, changes);
    setSnapshot(next);
    setNotice(configured ? 'Changes saved to Google Sheets.' : 'Preview updated. Changes reset when you reload this page.');
  }
  function openProperty(property: Property) { setEditRevision(snapshot?.revision ?? ''); setSelected(property); }
  function openAdd() { setEditRevision(snapshot?.revision ?? ''); setAdding(true); }
  function openImport() { setEditRevision(snapshot?.revision ?? ''); setImportOpen(true); }
  function navigate(next: View) { setView(next); setMobileNav(false); setStatus('all'); setSearch(''); }
  async function download() {
    if (!snapshot || !month) return;
    setExporting(true); setError('');
    try { await exportWorkbook(snapshot, month.id); setNotice('Monthly workbook downloaded.'); }
    catch (e) { setError(errorText(e)); }
    finally { setExporting(false); }
  }

  return <div className="app-shell">
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
      <a className="brand" href="#overview" onClick={event => { event.preventDefault(); navigate('overview'); }} aria-label="Castle overview"><span className="brand-mark"><Castle size={27} strokeWidth={1.7} /></span><span>castle<span className="brand-caption">PROPERTY FINANCE</span></span></a>
      <div className="workspace"><span className="workspace-icon"><Building2 size={18} /></span><span><strong>Castle portfolio</strong><small>Monthly accounts receivable</small></span><span className="workspace-dot" /></div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">
        <button className={view === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('overview')}><LayoutDashboard size={19} /><span>Overview</span>{view === 'overview' && <span className="nav-active-dot" />}</button>
        <button className={view === 'properties' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('properties')}><Building2 size={19} /><span>Properties</span><span className="nav-count">{properties.length}</span></button>
        <button className={view === 'reconciliation' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('reconciliation')}><ClipboardCheck size={19} /><span>Reconciliation</span>{unverified > 0 && <span className="nav-count">{unverified}</span>}</button>
      </nav>
      <TeamMenu configured={configured} onConfigure={onConfigure} onHelp={() => setHelpOpen(true)} />
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}><Menu size={22} /></button><span>Workspace</span><ChevronRight size={14} /><strong>{view === 'overview' ? 'Overview' : view === 'properties' ? 'Properties' : 'Reconciliation'}</strong></div><div className="topbar-right"><span className={`connection-indicator ${configured ? 'connected' : ''}`}><span />{configured ? 'Google Sheets connected' : 'Preview workspace'}</span><span className="topbar-divider" /><span className="top-avatar" title="Shared Castle workspace">C</span></div></header>
      <main>
        {!configured && <div className="preview-banner"><span><FileSpreadsheet size={16} /><strong>Preview data</strong><span className="preview-copy"> · connect Google Sheets to share changes</span></span><button onClick={onConfigure}>Connect sheet <ArrowRight size={14} /></button></div>}
        <section className="page-heading"><div><div className="eyebrow">YOUR PORTFOLIO, AT A GLANCE</div><h1>{view === 'overview' ? 'Monthly overview' : view === 'properties' ? 'Property records' : 'Payment reconciliation'}</h1><p>{view === 'overview' ? 'A clear picture of what’s collected and what’s coming in.' : view === 'properties' ? 'Every property, payment, and outstanding balance in one place.' : 'Match bank deposits and review your monthly payments.'}</p></div><div className="heading-actions"><div className="month-select"><CalendarDays size={17} /><select aria-label="Reporting month" value={month?.id ?? ''} disabled={!snapshot?.months.length} onChange={event => { setMonthId(event.target.value); setManager('all'); setStatus('all'); setSearch(''); }}>{snapshot?.months.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}{!snapshot?.months.length && <option value="">Reporting month</option>}</select><ChevronDown size={14} /></div><button className="icon-button sync-button" onClick={() => void load()} disabled={loading} aria-label="Refresh records" title="Refresh records"><RefreshCw size={18} className={loading ? 'spin' : ''} /></button></div></section>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void load()}>Retry <RefreshCw size={14} /></button></div>}
        {loading && !snapshot ? <div className="loading-state" role="status"><Loader2 size={28} className="spin" /><h2>Loading your portfolio</h2><p>Getting the latest monthly records…</p></div> : !snapshot ? <div className="empty-state"><FileSpreadsheet size={34} /><h2>Your records couldn’t be loaded</h2><p>Check your connection and try again.</p><button className="button primary" onClick={() => void load()}>Try again</button><button className="button quiet" onClick={onConfigure}>Connection settings</button></div> : !month ? <div className="empty-state"><CalendarDays size={34} /><h2>No monthly records yet</h2><p>Add a monthly tab in your connected Google Sheet, then refresh.</p><button className="button secondary" onClick={() => void load()}><RefreshCw size={16} />Refresh records</button></div> : <>
          <section className="metrics" aria-label="Monthly totals">
            <Metric title="Total expected" value={money(total)} detail={`${properties.length} ${properties.length === 1 ? 'property' : 'properties'} this month`} icon={<Wallet size={19} />} />
            <Metric title="Amount collected" value={money(received)} detail={`${progress}% of expected amount`} icon={<ArrowDownLeft size={20} />} tone="green" adornment={<span className="metric-mini-bar"><span style={{ width: `${progress}%` }} /></span>} />
            <Metric title="Outstanding balance" value={money(outstanding)} detail={`${properties.filter(property => balance(property) > 0).length} properties with a balance`} icon={<Clock3 size={19} />} tone="amber" />
            <Metric title="Awaiting verification" value={String(unverified).padStart(2, '0')} detail={`${verified} of ${payments.length} payments verified by Daisy`} icon={<ShieldCheck size={19} />} tone="blue" adornment={<span className="metric-caption">PAYMENTS</span>} />
          </section>
          <div className={`content-layout ${view !== 'overview' ? 'full-width' : ''}`}>
            <section className="records-panel panel">
              <div className="panel-heading"><div><h2>{view === 'reconciliation' ? 'Payment register' : 'Property overview'}<span className="count-pill">{properties.length}</span></h2><p>{view === 'reconciliation' ? 'Compare payout bundles with bank deposits.' : `Track collections across your ${month.label} portfolio.`}</p></div><div className="panel-actions"><button className="button secondary compact" onClick={openImport}><Upload size={15} /><span>Import Excel</span></button><button className="button primary compact" onClick={openAdd}><Plus size={16} /><span>Add property</span></button></div></div>
              <div className="record-tabs" aria-label="Filter property records"><button className={status === 'all' ? 'selected' : ''} onClick={() => setStatus('all')}>All properties <span>{properties.length}</span></button><button className={status === 'outstanding' ? 'selected' : ''} onClick={() => setStatus('outstanding')}>Outstanding <span>{properties.filter(property => balance(property) > 0).length}</span></button><button className={status === 'paid' ? 'selected' : ''} onClick={() => setStatus('paid')}>Collected</button></div>
              <div className="filter-row"><label className="search-field"><Search size={17} /><input type="search" placeholder="Search properties…" aria-label="Search properties" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="select-field"><select aria-label="Filter by manager" value={manager} onChange={event => setManager(event.target.value)}><option value="all">All managers</option>{managers.map(item => <option key={item} value={item}>{item}</option>)}</select><ChevronDown size={14} /></div><div className="select-field status-select"><select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value as StatusFilter)}><option value="all">All statuses</option><option value="outstanding">Outstanding</option><option value="paid">Collected</option><option value="unverified">Needs verification</option></select><ChevronDown size={14} /></div></div>
              {filtered.length === 0 ? <div className="empty-state compact-empty"><Search size={28} /><h3>{properties.length ? 'No matching properties' : 'Your first property starts here'}</h3><p>{properties.length ? 'Try a different search or clear your filters.' : 'Add a property to start tracking monthly collections.'}</p><button className="button secondary" onClick={() => { if (!properties.length) openAdd(); else { setSearch(''); setManager('all'); setStatus('all'); } }}>{properties.length ? 'Clear filters' : 'Add property'}</button></div> : view === 'reconciliation' ? <div className="table-scroll"><table className="reconciliation-table"><thead><tr><th>Property / payment</th><th className="number">Received</th><th>Payout date</th><th className="number">Bundle</th><th className="number">Bank deposit</th><th>System check</th><th>Daisy check</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{filtered.flatMap(property => property.payments.map((payment, index) => <tr key={payment.id}><td><button className="table-property-button" onClick={() => openProperty(property)}><strong>{property.name}</strong><span>{payment.type} {payment.type === 'Airbnb' ? index + 1 : ''}</span></button></td><td className="number">{money(payment.amountCents)}</td><td>{shortDate(payment.payoutDate)}</td><td className="number">{money(payment.bundleCents)}</td><td className="number">{money(payment.bankCents)}</td><td><SystemBadge payment={payment} /></td><td><span className={`verification-label ${payment.verifiedByDaisy ? 'verified' : ''}`}>{payment.verifiedByDaisy ? <CheckCheck size={14} /> : <Clock3 size={14} />}{payment.verifiedByDaisy ? 'Verified' : 'Pending'}</span></td><td><button className="icon-button" onClick={() => openProperty(property)} aria-label={`Edit ${property.name} payments`}><ChevronRight size={17} /></button></td></tr>))}</tbody></table></div> : <>
                <div className="table-scroll property-table-wrap"><table className="property-table"><thead><tr><th>Property</th><th className="number">Expected</th><th className="number">Collected</th><th className="number">Outstanding</th><th>Status</th><th><span className="sr-only">Open property</span></th></tr></thead><tbody>{filtered.map((property, index) => <tr key={property.id}><td><button className="property-name-cell" onClick={() => openProperty(property)}><span className={`property-icon tint-${index % 3}`}><Building2 size={21} strokeWidth={1.6} /></span><span><strong>{property.name}</strong><small>{property.manager || 'No manager assigned'}</small></span></button></td><td className="number">{money(property.totalCents)}</td><td className="number collected-cell">{money(collected(property))}</td><td className="number balance-cell">{money(balance(property))}</td><td><span className={`status-badge ${balance(property) <= 0 ? 'paid' : collected(property) > 0 ? 'partial' : 'unpaid'}`}><span />{propertyStatus(property)}</span></td><td><button className="icon-button row-open" onClick={() => openProperty(property)} aria-label={`Open ${property.name}`}><ChevronRight size={17} /></button></td></tr>)}</tbody><tfoot><tr><td>Portfolio total</td><td className="number">{money(filtered.reduce((sum, property) => sum + property.totalCents, 0))}</td><td className="number collected-cell">{money(filtered.reduce((sum, property) => sum + collected(property), 0))}</td><td className="number balance-cell">{money(filtered.reduce((sum, property) => sum + balance(property), 0))}</td><td colSpan={2} /></tr></tfoot></table></div>
                <div className="property-mobile-list">{filtered.map((property, index) => <button className="property-mobile-card" key={property.id} onClick={() => openProperty(property)}><div className="mobile-property-heading"><span className={`property-icon tint-${index % 3}`}><Building2 size={20} /></span><span><strong>{property.name}</strong><small>{property.manager || 'No manager assigned'}</small></span><ChevronRight size={18} /></div><div className="mobile-property-amounts"><span><small>Expected</small><strong>{money(property.totalCents)}</strong></span><span><small>Collected</small><strong className="collected-cell">{money(collected(property))}</strong></span><span><small>Outstanding</small><strong>{money(balance(property))}</strong></span></div><span className={`status-badge ${balance(property) <= 0 ? 'paid' : 'partial'}`}><span />{propertyStatus(property)}</span></button>)}</div>
              </>}
              <div className="table-footer"><span>Showing {filtered.length} of {properties.length} properties</span><button onClick={() => void download()} disabled={exporting}><ArrowDownToLine size={15} />{exporting ? 'Exporting…' : 'Export workbook'}</button></div>
            </section>
            {view === 'overview' && <aside className="summary-column">
              <section className="panel collection-panel"><div className="section-title"><h2>Collection progress</h2><span className="subtle-icon"><Wallet size={17} /></span></div><div className="progress-donut" style={{ background: `conic-gradient(var(--green) 0% ${progress}%, #e5e7eb ${progress}% 100%)` }} role="img" aria-label={`${progress}% of expected amount collected`}><div><strong>{progress}<span>%</span></strong><small>collected</small></div></div><div className="progress-legend"><div><span><i className="legend-dot green" />Collected</span><strong>{money(received)}</strong></div><div><span><i className="legend-dot gray" />Outstanding</span><strong>{money(outstanding)}</strong></div></div><div className="collection-note"><span className="note-icon"><ArrowUpRight size={16} /></span><p>{progress >= 100 ? 'Your expected amount is fully collected.' : <><strong>{money(outstanding)}</strong> left to collect this month.</>}</p></div></section>
              <section className="panel channel-panel"><h2>Payment sources</h2><p>Collected by channel</p><div className="channel-stack">{channelTotals.map(channel => <div className="channel-row" key={channel.type}><span className={`channel-icon ${channel.type.toLowerCase()}`}>{channel.type === 'Airbnb' ? 'A' : channel.type === 'Vrbo' ? 'V' : <Building2 size={16} />}</span><div><span>{channel.type}</span><div className="channel-bar"><span style={{ width: `${received > 0 ? Math.max(0, channel.cents / received * 100) : 0}%` }} /></div></div><strong>{money(channel.cents)}</strong></div>)}</div></section>
            </aside>}
          </div>
          {view === 'overview' && <section className="review-callout"><span className="review-icon"><ClipboardCheck size={24} /></span><div><h3>{unverified ? 'A little review goes a long way.' : 'Keep every payment accounted for.'}</h3><p>{unverified ? `${unverified} payments are waiting for Daisy’s verification. Review payout and bank details to close the loop.` : 'Use reconciliation to match payout bundles to bank deposits and verify your records.'}</p></div><button className="button secondary" onClick={() => { setView('reconciliation'); setStatus('unverified'); }}>Review payments<ArrowRight size={16} /></button></section>}
          <footer className="page-footer"><span><span className={`footer-dot ${configured ? 'live' : ''}`} />{configured ? 'Shared Google Sheets records' : 'Temporary preview · changes reset on reload'}</span><span>{snapshot.updatedAt ? `Records updated ${new Date(snapshot.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Ready to review'}{snapshot.spreadsheetUrl && <a href={snapshot.spreadsheetUrl} target="_blank" rel="noreferrer">Open spreadsheet<ExternalLink size={12} /></a>}</span></footer>
        </>}
      </main>
    </div>
    {notice && <div className="toast" role="status"><CheckCircle2 size={18} />{notice}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {selected && <PropertyDrawer key={selected.id} property={selected} monthLabel={month?.label ?? ''} configured={configured} onClose={() => setSelected(null)} onSave={async changes => { await applyChanges(changes); setSelected(null); }} />}
    {adding && month && <AddProperty month={month} onClose={() => setAdding(false)} onSave={async changes => { await applyChanges(changes); setAdding(false); }} />}
    {importOpen && month && <ImportWizard month={month} onClose={() => setImportOpen(false)} onApply={async changes => { await applyChanges(changes); setImportOpen(false); }} />}
    {helpOpen && <Dialog title="Your monthly AR workflow" className="workflow-dialog" onClose={() => setHelpOpen(false)}><WorkflowGuide /></Dialog>}
  </div>;
}

function Metric({ title, value, detail, icon, tone = 'neutral', adornment }: { title: string; value: string; detail: string; icon: ReactNode; tone?: string; adornment?: ReactNode }) {
  return <article className={`metric-card ${tone}`}><div className="metric-header"><span>{title}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{value}{adornment}</div><div className="metric-detail">{detail}</div></article>;
}
function SystemBadge({ payment }: { payment: Payment }) { const status = systemStatus(payment); return <span className={`system-badge ${status.toLowerCase()}`}>{status === 'Matched' ? <Check size={12} /> : status === 'Mismatch' ? <X size={12} /> : <Clock3 size={12} />}{status}</span>; }

export function Dialog({ title, onClose, children, className = '', busy = false, subtitle }: { title: string; onClose: () => void; children: ReactNode; className?: string; busy?: boolean; subtitle?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => { document.body.style.overflow = overflow; prior?.focus(); };
  }, []);
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); close.current(); }
    if (event.key !== 'Tab') return;
    const focusable = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
    if (!focusable?.length) { event.preventDefault(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
  }
  return <div className={`modal-backdrop ${className === 'drawer' ? 'drawer-backdrop' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className={`dialog ${className}`} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}><div className="dialog-header"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}><X size={21} /></button></div>{children}</div></div>;
}

function PropertyDrawer({ property, monthLabel, configured, onClose, onSave }: { property: Property; monthLabel: string; configured: boolean; onClose: () => void; onSave: (changes: Change[]) => Promise<void> }) {
  const [total, setTotal] = useState(formatAmount(property.totalCents));
  const initialDrafts = useMemo(() => Object.fromEntries(property.payments.map(payment => [payment.id, { amount: formatAmount(payment.amountCents), payoutDate: payment.payoutDate, bundle: formatAmount(payment.bundleCents), bankDate: payment.bankDate, bank: formatAmount(payment.bankCents), verifiedByDaisy: payment.verifiedByDaisy }])), [property]);
  const [drafts, setDrafts] = useState<Record<string, PaymentDraft>>(initialDrafts);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = total !== formatAmount(property.totalCents) || JSON.stringify(drafts) !== JSON.stringify(initialDrafts);
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
      if (amount !== property.totalCents) changes.push({ kind: 'setTotal', propertyId: property.id, amountCents: amount });
      for (const payment of property.payments) {
        const fields = paymentDraftToFields(payment, drafts[payment.id]);
        if (Object.keys(fields).length) changes.push({ kind: 'updatePayment', paymentId: payment.id, fields });
      }
      if (!changes.length) { onClose(); return; }
      setSaving(true); await onSave(changes);
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  }
  return <Dialog title={property.name} subtitle={`${property.manager || 'No manager'} · ${monthLabel}`} className="drawer" onClose={close} busy={saving}><form className="drawer-form" onSubmit={save}><div className="drawer-content"><div className="drawer-summary"><label>Expected amount<input aria-label="Property expected amount" inputMode="decimal" value={total} onChange={event => setTotal(event.target.value)} required disabled={saving} /></label><div><span>Collected</span><strong className="collected-cell">{money(previewCollected)}</strong></div><div><span>Outstanding</span><strong>{money(previewTotal - previewCollected)}</strong></div></div><div className="drawer-section-heading"><h3>Payment details</h3><span>{property.payments.length} payment rows</span></div><p className="field-help">Enter amounts using a decimal point. A blank amount clears that field; zero records a zero payment.</p><div className="payment-cards">{property.payments.map((payment, index) => {
    const draft = drafts[payment.id];
    let preview = payment;
    try { preview = { ...payment, bundleCents: parseMoney(draft.bundle), bankCents: parseMoney(draft.bank) }; } catch { /* Invalid input is explained when saving. */ }
    return <fieldset className="payment-card" key={payment.id} disabled={saving}><legend><span className={`channel-icon ${payment.type.toLowerCase()}`}>{payment.type === 'Airbnb' ? 'A' : payment.type === 'Vrbo' ? 'V' : <Building2 size={14} />}</span>{payment.type}{payment.type === 'Airbnb' && <span className="payment-sequence">Payment {index + 1}</span>}</legend><div className="payment-field-grid"><label>Payment amount<input aria-label={`${payment.type} ${index + 1} payment amount`} inputMode="decimal" placeholder="0.00" value={draft.amount} onChange={event => update(payment.id, 'amount', event.target.value)} /></label><label>Payout date<input type="date" value={draft.payoutDate} onChange={event => update(payment.id, 'payoutDate', event.target.value)} /></label><label>Bundle amount<input inputMode="decimal" placeholder="Not entered" value={draft.bundle} onChange={event => update(payment.id, 'bundle', event.target.value)} /></label><label>Bank amount<input inputMode="decimal" placeholder="Not entered" value={draft.bank} onChange={event => update(payment.id, 'bank', event.target.value)} /></label><label>Bank date<input type="date" value={draft.bankDate} onChange={event => update(payment.id, 'bankDate', event.target.value)} /></label><div className="system-field"><span>System verification</span><SystemBadge payment={preview} /></div></div><label className="verification-checkbox"><input type="checkbox" checked={draft.verifiedByDaisy} onChange={event => update(payment.id, 'verifiedByDaisy', event.target.checked)} /><span>Verified by Daisy</span><ShieldCheck size={15} /></label></fieldset>;
  })}</div><div className="drawer-info"><ShieldCheck size={18} /><p>System verification compares the bundle and bank amounts. Daisy’s verification records a separate manual review.</p></div></div><div className="drawer-footer">{error && <div className="form-error" role="alert">{error}</div>}<div className="drawer-footer-actions"><span>{configured ? 'Saved to your shared Google Sheet' : 'Temporary preview · resets on reload'}</span><button type="button" className="button secondary" onClick={close} disabled={saving}>Cancel</button><button type="submit" className="button primary" disabled={saving || !dirty}>{saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}{saving ? 'Saving…' : 'Save changes'}</button></div></div></form></Dialog>;
}

function AddProperty({ month, onClose, onSave }: { month: Month; onClose: () => void; onSave: (changes: Change[]) => Promise<void> }) {
  const [name, setName] = useState(''); const [manager, setManager] = useState(''); const [amount, setAmount] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      if (!name.trim()) throw new Error('Enter a property name.');
      if (!manager.trim()) throw new Error('Enter a property manager.');
      if (month.properties.some(property => property.name.trim().toLowerCase() === name.trim().toLowerCase())) throw new Error('This property already exists in the selected month.');
      const total = parseMoney(amount); if (total === null || total < 0) throw new Error('Enter an expected amount of zero or more.');
      setSaving(true); await onSave([{ kind: 'addProperty', monthId: month.id, name: name.trim(), manager: manager.trim(), totalCents: total }]);
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  }
  return <Dialog title="Add a property" subtitle={`Create a monthly record for ${month.label}`} onClose={onClose} busy={saving}><form onSubmit={submit} className="add-form"><label>Property name<input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Castle Beach House" maxLength={120} required disabled={saving} /></label><label>Property manager (required)<input required value={manager} onChange={event => setManager(event.target.value)} placeholder="Manager name" maxLength={120} disabled={saving} /></label><label>Expected amount<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" required disabled={saving} /></label><p className="field-help">Airbnb, Vrbo, and owner payment rows will be created with your property.</p>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}{saving ? 'Adding…' : 'Add property'}</button></div></form></Dialog>;
}
