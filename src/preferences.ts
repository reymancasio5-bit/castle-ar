export type View = 'overview' | 'properties' | 'reconciliation';
export type StatusFilter = 'all' | 'outstanding' | 'paid' | 'unverified';

export interface Preferences {
  defaultView: View;
  defaultManager: string;
  defaultStatus: StatusFilter;
  density: 'comfortable' | 'compact';
  dateFormat: 'friendly' | 'day-first' | 'iso';
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  defaultView: 'overview',
  defaultManager: 'all',
  defaultStatus: 'all',
  density: 'comfortable',
  dateFormat: 'friendly',
});

const STORAGE_KEY = 'castle-user-preferences-v1';

function validChoice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === 'string' && choices.includes(value as T) ? value as T : fallback;
}

export function normalizePreferences(value: unknown): Preferences {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    defaultView: validChoice(source.defaultView, ['overview', 'properties', 'reconciliation'], DEFAULT_PREFERENCES.defaultView),
    defaultManager: typeof source.defaultManager === 'string' && source.defaultManager.trim()
      ? source.defaultManager.trim()
      : DEFAULT_PREFERENCES.defaultManager,
    defaultStatus: validChoice(source.defaultStatus, ['all', 'outstanding', 'paid', 'unverified'], DEFAULT_PREFERENCES.defaultStatus),
    density: validChoice(source.density, ['comfortable', 'compact'], DEFAULT_PREFERENCES.density),
    dateFormat: validChoice(source.dateFormat, ['friendly', 'day-first', 'iso'], DEFAULT_PREFERENCES.dateFormat),
  };
}

export function loadPreferences(storage?: Pick<Storage, 'getItem'>): Preferences {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    const stored = target?.getItem(STORAGE_KEY);
    return normalizePreferences(stored ? JSON.parse(stored) : undefined);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** Returns false when the browser cannot persist the preferences. */
export function savePreferences(preferences: Preferences, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!target) return false;
    target.setItem(STORAGE_KEY, JSON.stringify(normalizePreferences(preferences)));
    return true;
  } catch {
    return false;
  }
}

/** Payment values are ISO calendar dates, independent of the viewer's timezone. */
export function formatPaymentDate(date: string, format: Preferences['dateFormat']): string {
  if (!date) return '—';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return date;
  if (format === 'iso') return date;
  if (format === 'day-first') return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
