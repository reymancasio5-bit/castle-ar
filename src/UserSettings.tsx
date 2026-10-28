import { useId, useState } from 'react';
import { DEFAULT_PREFERENCES, type Preferences } from './preferences';
import './UserSettings.css';

interface UserSettingsProps {
  preferences: Preferences;
  managers: string[];
  onSave: (next: Preferences) => void;
  onCancel: () => void;
}

export default function UserSettings({ preferences, managers, onSave, onCancel }: UserSettingsProps) {
  const [draft, setDraft] = useState<Preferences>(() => ({ ...preferences }));
  const id = useId();
  const availableManagers = [...new Set(managers)].filter(manager => manager && manager !== 'all');
  const missingManager = preferences.defaultManager !== 'all' && !availableManagers.includes(preferences.defaultManager);

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setDraft(current => ({ ...current, [key]: value }));
  }

  return <form className="user-settings" onSubmit={event => { event.preventDefault(); onSave({ ...draft }); }}>
    <div className="settings-content">
      <p className="settings-intro">Personal to this browser. These preferences change your view of the shared records.</p>

      <fieldset className="settings-section">
        <legend>Your workspace</legend>
        <p className="settings-section-help">These defaults apply when you open the app or save your preferences. You can still switch pages and filters as you work.</p>

        <div className="settings-field">
          <div className="settings-field-copy">
            <label htmlFor={`${id}-view`}>Opening page</label>
            <p id={`${id}-view-help`}>Start with your overview, property records, or payment reconciliation.</p>
          </div>
          <select id={`${id}-view`} value={draft.defaultView} aria-describedby={`${id}-view-help`} onChange={event => update('defaultView', event.target.value as Preferences['defaultView'])}>
            <option value="overview">Overview</option>
            <option value="properties">Properties</option>
            <option value="reconciliation">Reconciliation</option>
          </select>
        </div>

        <div className="settings-field">
          <div className="settings-field-copy">
            <label htmlFor={`${id}-manager`}>Default manager/team</label>
            <p id={`${id}-manager-help`}>Start with records assigned to this manager. This filter does not change anyone’s access.</p>
          </div>
          <select id={`${id}-manager`} value={draft.defaultManager} aria-describedby={`${id}-manager-help`} onChange={event => update('defaultManager', event.target.value)}>
            <option value="all">All managers</option>
            {availableManagers.map(manager => <option key={manager} value={manager}>{manager}</option>)}
            {missingManager && <option value={preferences.defaultManager}>{preferences.defaultManager} (not in current records)</option>}
          </select>
        </div>

        <div className="settings-field">
          <div className="settings-field-copy">
            <label htmlFor={`${id}-status`}>Default record filter</label>
            <p id={`${id}-status-help`}>Choose which properties are shown by default in your records list.</p>
          </div>
          <select id={`${id}-status`} value={draft.defaultStatus} aria-describedby={`${id}-status-help`} onChange={event => update('defaultStatus', event.target.value as Preferences['defaultStatus'])}>
            <option value="all">All statuses</option>
            <option value="outstanding">Outstanding</option>
            <option value="paid">Collected</option>
            <option value="unverified">Needs verification</option>
          </select>
        </div>
      </fieldset>

      <fieldset className="settings-section">
        <legend>Display</legend>
        <div className="settings-field">
          <div className="settings-field-copy">
            <label htmlFor={`${id}-density`}>Table spacing</label>
            <p id={`${id}-density-help`}>Use more room between rows, or fit more table rows on wider screens.</p>
          </div>
          <select id={`${id}-density`} value={draft.density} aria-describedby={`${id}-density-help`} onChange={event => update('density', event.target.value as Preferences['density'])}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </div>

        <div className="settings-field">
          <div className="settings-field-copy">
            <label htmlFor={`${id}-date`}>Date display</label>
            <p id={`${id}-date-help`}>Payout dates in the payment register. Date entry keeps your browser’s format.</p>
          </div>
          <select id={`${id}-date`} value={draft.dateFormat} aria-describedby={`${id}-date-help`} onChange={event => update('dateFormat', event.target.value as Preferences['dateFormat'])}>
            <option value="friendly">Month name · Oct 28, 2026</option>
            <option value="day-first">Day first · 28/10/2026</option>
            <option value="iso">ISO · 2026-10-28</option>
          </select>
        </div>
      </fieldset>
    </div>

    <div className="settings-actions">
      <button type="button" className="button quiet settings-reset" onClick={() => setDraft({ ...DEFAULT_PREFERENCES })}>Restore defaults</button>
      <div className="settings-save-actions">
        <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="button primary">Save preferences</button>
      </div>
    </div>
  </form>;
}
