import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadPreferences,
  savePreferences,
  normalizePreferences,
  formatPaymentDate,
  type Preferences,
} from '../src/preferences.ts';

const defaults: Preferences = {
  defaultView: 'overview',
  defaultManager: 'all',
  defaultStatus: 'all',
  density: 'comfortable',
  dateFormat: 'friendly',
};

test('missing or corrupt stored preferences recover usable defaults', () => {
  for (const stored of [null, '', '{broken', 'null', 'false', '42', '"compact"', '[]']) {
    assert.deepEqual(loadPreferences({ getItem: () => stored }), defaults);
  }
  const first = loadPreferences({ getItem: () => null });
  first.defaultManager = 'Changed';
  assert.deepEqual(loadPreferences({ getItem: () => null }), defaults);
});

test('normalization keeps valid preferences and drops unknown configuration fields', () => {
  assert.deepEqual(normalizePreferences({
    defaultView: 'reconciliation',
    defaultManager: '  Maria Chen  ',
    defaultStatus: 'unverified',
    density: 'compact',
    dateFormat: 'day-first',
    endpoint: 'https://example.com/should-not-persist',
    adminToken: 'should-not-persist',
  }), {
    defaultView: 'reconciliation',
    defaultManager: 'Maria Chen',
    defaultStatus: 'unverified',
    density: 'compact',
    dateFormat: 'day-first',
  });
});

test('invalid fields fall back individually without losing valid selections', () => {
  assert.deepEqual(normalizePreferences({
    defaultView: 'settings',
    defaultManager: '   ',
    defaultStatus: 'paid',
    density: true,
    dateFormat: 'iso',
  }), { ...defaults, defaultStatus: 'paid', dateFormat: 'iso' });
  for (const invalid of [undefined, null, false, 1, [], 'compact']) {
    assert.deepEqual(normalizePreferences(invalid), defaults);
  }
  assert.deepEqual(normalizePreferences({
    defaultView: 2,
    defaultManager: { name: 'Maria' },
    defaultStatus: 'pending',
    density: 'dense',
    dateFormat: 'locale',
  }), defaults);
});

test('every selectable view, status, density and date format survives normalization', () => {
  for (const defaultView of ['overview', 'properties', 'reconciliation'] as const) {
    assert.equal(normalizePreferences({ defaultView }).defaultView, defaultView);
  }
  for (const defaultStatus of ['all', 'outstanding', 'paid', 'unverified'] as const) {
    assert.equal(normalizePreferences({ defaultStatus }).defaultStatus, defaultStatus);
  }
  for (const density of ['comfortable', 'compact'] as const) {
    assert.equal(normalizePreferences({ density }).density, density);
  }
  for (const dateFormat of ['friendly', 'day-first', 'iso'] as const) {
    assert.equal(normalizePreferences({ dateFormat }).dateFormat, dateFormat);
  }
});

test('saving uses the preferences key and persists only validated fields for reload', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const preferences = {
    defaultView: 'properties',
    defaultManager: 'Alex Rivera',
    defaultStatus: 'outstanding',
    density: 'compact',
    dateFormat: 'iso',
    endpoint: 'https://example.com/private',
  } as const;
  assert.equal(savePreferences(preferences, storage), true);
  assert.deepEqual([...values.keys()], ['castle-user-preferences-v1']);
  assert.deepEqual(JSON.parse(values.get('castle-user-preferences-v1')!), {
    defaultView: 'properties',
    defaultManager: 'Alex Rivera',
    defaultStatus: 'outstanding',
    density: 'compact',
    dateFormat: 'iso',
  });
  assert.deepEqual(loadPreferences(storage), {
    defaultView: 'properties',
    defaultManager: 'Alex Rivera',
    defaultStatus: 'outstanding',
    density: 'compact',
    dateFormat: 'iso',
  });
  assert.equal(savePreferences({ ...preferences, density: 'invalid' } as unknown as Preferences, storage), true);
  assert.equal(loadPreferences(storage).density, 'comfortable');
});

test('blocked reads and quota failures return defaults or failure without throwing', () => {
  assert.deepEqual(loadPreferences({ getItem: () => { throw new Error('Storage blocked'); } }), defaults);
  assert.equal(savePreferences(defaults, { setItem: () => { throw new Error('Quota exceeded'); } }), false);
});

test('browser storage can be absent or inaccessible', () => {
  assert.deepEqual(loadPreferences(), defaults);
  assert.equal(savePreferences(defaults), false);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { get localStorage() { throw new Error('Privacy mode'); } },
  });
  try {
    assert.deepEqual(loadPreferences(), defaults);
    assert.equal(savePreferences(defaults), false);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('payment dates use the selected display format', () => {
  assert.equal(formatPaymentDate('2026-11-24', 'friendly'), 'Nov 24, 2026');
  assert.equal(formatPaymentDate('2026-11-24', 'day-first'), '24/11/2026');
  assert.equal(formatPaymentDate('2026-11-24', 'iso'), '2026-11-24');
  assert.equal(formatPaymentDate('2024-02-29', 'friendly'), 'Feb 29, 2024');
  assert.equal(formatPaymentDate('2026-01-01', 'day-first'), '01/01/2026');
});

test('calendar dates stay on the same day across timezone boundaries', () => {
  const previousTimezone = process.env.TZ;
  try {
    for (const timezone of ['Pacific/Honolulu', 'Pacific/Kiritimati', 'America/New_York']) {
      process.env.TZ = timezone;
      assert.equal(formatPaymentDate('2026-01-01', 'friendly'), 'Jan 1, 2026');
      assert.equal(formatPaymentDate('2026-03-08', 'friendly'), 'Mar 8, 2026');
      assert.equal(formatPaymentDate('2026-12-31', 'iso'), '2026-12-31');
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('empty dates show a placeholder and invalid calendar dates remain visible unchanged', () => {
  for (const format of ['friendly', 'day-first', 'iso'] as const) {
    assert.equal(formatPaymentDate('', format), '—');
    for (const invalid of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-2', '11/24/2026', 'pending', '2026-11-24T00:00:00Z']) {
      assert.equal(formatPaymentDate(invalid, format), invalid);
    }
  }
});
