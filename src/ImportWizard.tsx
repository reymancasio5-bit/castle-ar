import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, FileSpreadsheet, Upload, X } from 'lucide-react';
import type { ImportProps } from './types.ts';
import { money } from './domain.ts';
import { buildImportPreview, destinations, inferColumns, type ImportDestination, type ImportOptions, type ImportSheet } from './import.ts';
import { readSpreadsheet } from './excel.ts';
import { useExiting } from './Presence';
import './import.css';

const PAGE_SIZE = 30;
const initialOptions: ImportOptions = { headerRow: 0, nameColumn: 0, amountColumn: 1, destination: 'total', sumDuplicates: false };
function columnLetter(index: number) {
  let result = '';
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) result = String.fromCharCode(65 + (current - 1) % 26) + result;
  return result;
}
function cellText(value: unknown) { return value == null ? '' : value instanceof Date ? value.toISOString().slice(0, 10) : String(value); }

export function ImportWizard({ month, onClose, onApply }: ImportProps) {
  const exiting = useExiting();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<ImportSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [options, setOptions] = useState<ImportOptions>(initialOptions);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [page, setPage] = useState(0);
  const [rowFilter, setRowFilter] = useState('all');
  const requestRef = useRef(0);
  const sheet = sheets[sheetIndex];
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      requestRef.current++;
      dialog?.close();
      previouslyFocused?.focus();
    };
  }, []);

  const previewState = useMemo(() => {
    if (!sheet) return { preview: null, error: '' };
    try { return { preview: buildImportPreview(month, sheet, options), error: '' }; }
    catch (cause) { return { preview: null, error: cause instanceof Error ? cause.message : 'Check the selected columns.' }; }
  }, [month, options, sheet]);
  const preview = previewState.preview;
  const columnCount = sheet?.rows.reduce((max, row) => Math.max(max, row.length), 0) ?? 0;
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const heading = options.headerRow === null ? '' : cellText(sheet?.rows[options.headerRow]?.[index]?.value);
    return { index, label: `${columnLetter(index)}${heading ? ` — ${heading}` : ' — No heading'}` };
  });
  const visibleRows = preview?.rows.filter(row => rowFilter === 'all' || row.status === rowFilter) ?? [];
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount - 1);
  const pageRows = visibleRows.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE);
  const targetLabel = destinations.find(destination => destination.value === options.destination)?.label ?? '';

  async function chooseFile(file?: File) {
    if (!file) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const nextSheets = await readSpreadsheet(file);
      if (request !== requestRef.current) return;
      const nextIndex = Math.max(0, nextSheets.findIndex(candidate => !candidate.error && candidate.rows.length));
      setSheets(nextSheets);
      setSheetIndex(nextIndex);
      setOptions({ ...initialOptions, ...inferColumns(nextSheets[nextIndex]) });
      setFileName(file.name);
      setStep(2);
      setPage(0);
      setRowFilter('all');
    } catch (cause) {
      if (request === requestRef.current) setError(cause instanceof Error ? cause.message : 'The file could not be read.');
    } finally {
      if (request === requestRef.current) setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function changeSheet(index: number) {
    setSheetIndex(index);
    setOptions(current => ({ ...current, ...inferColumns(sheets[index]) }));
    setPage(0);
    setError('');
  }

  async function applyImport() {
    if (!preview?.changes.length || saving || exiting) return;
    setSaving(true);
    setError('');
    try {
      // The complete, validated mutation list is sent in one save operation.
      await onApply(preview.changes);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import could not be saved. Your preview is still available.');
    } finally { setSaving(false); }
  }

  return createPortal(
    <dialog ref={dialogRef} className="import-modal" data-exiting={exiting} inert={exiting} aria-labelledby="import-title" aria-describedby="import-description"
      onCancel={event => { event.preventDefault(); if (!saving && !exiting) onClose(); }}
      onClick={event => {
        if (event.target !== event.currentTarget || saving || exiting) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <header className="import-header">
        <div className="import-header-icon"><FileSpreadsheet size={23} aria-hidden="true" /></div>
        <div><p className="import-eyebrow">EXCEL IMPORT</p><h2 id="import-title">Bring your amounts in</h2><p id="import-description">Import into {month.label}. Match your columns, then review every change.</p></div>
        <button className="import-icon-button" aria-label="Close import" onClick={onClose} disabled={saving}><X size={21} aria-hidden="true" /></button>
      </header>

      <ol className="import-steps" aria-label="Import progress">
        {['Choose file', 'Match columns', 'Review & import'].map((label, index) => <li key={label} className={step === index + 1 ? 'import-step-current' : step > index + 1 ? 'import-step-done' : ''} aria-current={step === index + 1 ? 'step' : undefined}>
          <span>{step > index + 1 ? <Check size={15} aria-hidden="true" /> : index + 1}</span>{label}
        </li>)}
      </ol>

      <div className="import-content" aria-busy={loading || saving}>
        {error && <div className="import-alert" role="alert">{error}</div>}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="import-hidden-input" tabIndex={-1} aria-label="Choose spreadsheet file" onChange={event => void chooseFile(event.target.files?.[0])} />
        <div className="import-step-content" key={step}>
        {step === 1 && <>
          <div className={`import-dropzone ${dragging ? 'import-dropzone-active' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!loading) void chooseFile(event.dataTransfer.files[0]); }}>
            <div className="import-upload-icon"><Upload size={30} aria-hidden="true" /></div>
            <h3>{loading ? 'Reading your spreadsheet…' : 'Drop a spreadsheet here'}</h3>
            <p>Your columns can be in any order.</p>
            <button className="import-button import-button-primary" disabled={loading} onClick={() => fileRef.current?.click()}>{loading ? 'Reading file…' : 'Choose a file'}</button>
            <small>Excel .xlsx / .xls or .csv · Up to 10 MB and 10,000 rows</small>
          </div>
          <div className="import-guidance"><CheckCircle2 size={19} aria-hidden="true" /><div><strong>You stay in control</strong><p>The file is read in your browser. You’ll see the exact changes before any amounts are saved.</p></div></div>
        </>}

        {step >= 2 && sheet && <div className="import-file-bar"><FileSpreadsheet size={20} aria-hidden="true" /><span title={fileName}>{fileName}</span><button className="import-text-button" disabled={loading || saving} onClick={() => fileRef.current?.click()}>{loading ? 'Reading…' : 'Change file'}</button></div>}

        {step === 2 && sheet && <>
          <div className="import-field-grid">
            <label className="import-field">Worksheet<select value={sheetIndex} onChange={event => changeSheet(Number(event.target.value))}>{sheets.map((candidate, index) => <option value={index} key={`${candidate.name}-${index}`}>{candidate.name}</option>)}</select></label>
            <div className="import-field"><label htmlFor="import-header-row">Header row</label><div className="import-header-controls"><input id="import-header-row" type="number" min={1} max={sheet.rows.length || 1} disabled={options.headerRow === null} value={options.headerRow === null ? '' : options.headerRow + 1} onChange={event => setOptions(current => ({ ...current, headerRow: Number(event.target.value) - 1 }))} /><label className="import-checkbox"><input type="checkbox" checked={options.headerRow === null} onChange={event => setOptions(current => ({ ...current, headerRow: event.target.checked ? null : 0 }))} />No headers</label></div></div>
            <label className="import-field">Property name column<select value={options.nameColumn} onChange={event => setOptions(current => ({ ...current, nameColumn: Number(event.target.value) }))}>{columns.map(column => <option value={column.index} key={column.index}>{column.label}</option>)}</select></label>
            <label className="import-field">Amount column<select value={options.amountColumn} onChange={event => setOptions(current => ({ ...current, amountColumn: Number(event.target.value) }))}>{columns.map(column => <option value={column.index} key={column.index}>{column.label}</option>)}</select></label>
            <label className="import-field import-field-full">Save amounts to<select value={options.destination} onChange={event => setOptions(current => ({ ...current, destination: event.target.value as ImportDestination }))}>{destinations.map(destination => <option value={destination.value} key={destination.value}>{destination.label}</option>)}</select><small>This replaces only the selected amount for matching properties in {month.label}.</small></label>
          </div>
          <label className="import-checkbox import-sum-choice"><input type="checkbox" checked={options.sumDuplicates} onChange={event => setOptions(current => ({ ...current, sumDuplicates: event.target.checked }))} /><span><strong>Sum duplicate property rows</strong><small>Use this when the file has several amounts for the same property. Otherwise, duplicates are excluded.</small></span></label>
          <div className="import-section-heading"><h3>File preview</h3><span>First {Math.min(sheet.rows.length, 8)} rows · Scroll to view all columns</span></div>
          {sheet.error ? <div className="import-alert" role="alert">{sheet.error}</div> : !sheet.rows.length ? <div className="import-empty">This worksheet is empty. Choose another worksheet.</div> : <div className="import-table-scroll import-source-scroll"><table className="import-table import-source-table"><thead><tr><th scope="col">Row</th>{columns.map(column => <th scope="col" key={column.index} className={column.index === options.nameColumn || column.index === options.amountColumn ? 'import-selected-column' : ''}>{columnLetter(column.index)}{column.index === options.nameColumn ? ' · Property' : column.index === options.amountColumn ? ' · Amount' : ''}</th>)}</tr></thead><tbody>{sheet.rows.slice(0, 8).map((row, index) => <tr key={index} className={options.headerRow === index ? 'import-header-preview' : ''}><th scope="row">{index + 1}{options.headerRow === index && <span className="import-header-tag">Header</span>}</th>{columns.map(column => <td key={column.index} title={cellText(row[column.index]?.value)}>{(row[column.index]?.formatted ?? cellText(row[column.index]?.value)) || '—'}</td>)}</tr>)}</tbody></table></div>}
          {previewState.error && !sheet.error && <p className="import-inline-error" role="alert">{previewState.error}</p>}
          <p className="import-footnote">Names match exactly, ignoring capitalization and extra spaces. Blank amounts are skipped; zero sets the amount to zero. Use a dot for decimals and commas for thousands.</p>
        </>}

        {step === 3 && preview && <>
          <div className="import-review-heading"><h3>{preview.changes.length} property {preview.changes.length === 1 ? 'amount' : 'amounts'} ready to update</h3><p>{targetLabel} · {month.label} · {sheet?.name}</p></div>
          <div className="import-counts" aria-label="Import row counts"><div><strong>{preview.readyCount}</strong><span>Ready rows</span></div><div><strong>{preview.unmatchedCount}</strong><span>Unmatched</span></div><div><strong>{preview.invalidCount}</strong><span>Need attention</span></div><div><strong>{preview.skippedCount}</strong><span>Skipped</span></div></div>
          {(preview.invalidCount > 0 || preview.unmatchedCount > 0) && <div className="import-warning">Only ready rows will be imported. Unmatched and invalid rows below will be excluded. You can go back to change your mapping or fix the source file.</div>}
          <div className="import-section-heading"><h3>Review changes</h3><label className="import-filter-label">Show<select value={rowFilter} onChange={event => { setRowFilter(event.target.value); setPage(0); }}><option value="all">All rows</option><option value="ready">Ready</option><option value="unmatched">Unmatched</option><option value="invalid">Need attention</option><option value="skipped">Skipped</option></select></label></div>
          <div className="import-table-scroll import-review-scroll">
            <table className="import-table import-review-table">
              <thead><tr><th scope="col">Row</th><th scope="col">Property / source</th><th scope="col" className="import-numeric">Current</th><th scope="col" className="import-numeric">File amount</th><th scope="col" className="import-numeric">New amount</th><th scope="col">Result</th></tr></thead>
              <tbody>{pageRows.map(row => <tr key={row.sourceRow}>
                <td className="import-muted">{row.sourceRow}</td>
                <td><strong>{row.propertyName || row.name || 'No property name'}</strong>{row.propertyName && row.propertyName !== row.name && <small>{row.name}</small>}</td>
                <td className="import-numeric">{row.currentCents == null ? '—' : money(row.currentCents)}</td>
                <td className="import-numeric">{row.amountCents === undefined ? row.originalAmount || '—' : money(row.amountCents)}</td>
                <td className="import-numeric">{row.proposedCents === undefined ? '—' : money(row.proposedCents)}</td>
                <td><span className={`import-status import-status-${row.status}`}>{row.status === 'invalid' ? 'Needs attention' : row.status === 'unmatched' ? 'Unmatched' : row.status === 'skipped' ? 'Skipped' : 'Ready'}</span><small className="import-row-reason">{row.reason}</small></td>
              </tr>)}{!pageRows.length && <tr><td colSpan={6} className="import-empty">No rows in this view.</td></tr>}</tbody>
            </table>
          </div>
          <div className="import-pagination"><span>{visibleRows.length ? `${activePage * PAGE_SIZE + 1}–${Math.min((activePage + 1) * PAGE_SIZE, visibleRows.length)} of ${visibleRows.length} rows` : '0 rows'}</span><div><button className="import-icon-button" aria-label="Previous preview page" disabled={activePage === 0 || saving} onClick={() => setPage(activePage - 1)}><ArrowLeft size={17} /></button><span>{activePage + 1} / {pageCount}</span><button className="import-icon-button" aria-label="Next preview page" disabled={activePage >= pageCount - 1 || saving} onClick={() => setPage(activePage + 1)}><ArrowRight size={17} /></button></div></div>
          {options.sumDuplicates && <p className="import-footnote">Repeated ready rows for one property will be summed into one replacement amount.</p>}
        </>}
        </div>
      </div>

      <footer className="import-footer"><button className="import-button import-button-secondary" onClick={() => { if (step === 1) onClose(); else { setStep(step - 1); setError(''); } }} disabled={saving || loading}>{step === 1 ? 'Cancel' : <><ArrowLeft size={16} aria-hidden="true" /> Back</>}</button><div className="import-footer-right">{step === 2 && <button className="import-button import-button-primary" disabled={loading || !preview || !preview.rows.length} onClick={() => { setStep(3); setPage(0); setRowFilter('all'); }}>Review import <ArrowRight size={16} aria-hidden="true" /></button>}{step === 3 && <button className="import-button import-button-primary" onClick={() => void applyImport()} disabled={saving || !preview?.changes.length}>{saving ? 'Saving import…' : `Import ${preview?.changes.length ?? 0} ${preview?.changes.length === 1 ? 'amount' : 'amounts'}`}<Check size={17} aria-hidden="true" /></button>}</div></footer>
    </dialog>, document.body,
  );
}

export default ImportWizard;
