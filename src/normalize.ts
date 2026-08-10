import type {
  KnackAddress,
  KnackConnection,
  KnackConnectionValue,
  KnackDate,
  KnackEmail,
  KnackFile,
  KnackLink,
  KnackPhone,
} from './types.js';

/**
 * Coercions for Knack's `_raw` values.
 *
 * Knack is inconsistent about which shape a field comes back as — equations
 * return strings sometimes and numbers other times, connections are arrays
 * except when they're a bare string. These normalize rather than assume.
 */

/** Connection value -> the connected records' display identifiers. */
export const valueToStrings = (value: KnackConnectionValue): string[] => {
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : (v?.identifier ?? '')))
      .filter((s) => s.length > 0);
  }
  return [];
};

/** Does a connection or multi-choice value match any of these labels? */
export const matchesAny = (value: KnackConnectionValue, options: string[]): boolean =>
  valueToStrings(value).some((s) => options.includes(s));

/** Connection value -> the connected records' ids. Ignores bare-string values. */
export const connectionIds = (value: KnackConnectionValue): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? '' : (v?.id ?? '')))
    .filter((s) => s.length > 0);
};

/** First connected record, or null. For 1:1 connections. */
export const firstConnection = (value: KnackConnectionValue): KnackConnection | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  return typeof first === 'string' ? null : (first ?? null);
};

/**
 * Equation, sum, count and currency fields may arrive as either a number or a
 * formatted string. Always route them through here.
 */
export const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    // Strip currency symbols, thousands separators and stray whitespace.
    const cleaned = value.replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return fallback;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
};

export const toBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === 'yes' || v === 'on' || v === '1';
  }
  return Boolean(value);
};

/** Knack date raw -> JS Date, or null. Prefers unambiguous representations. */
export const toDate = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'object') {
    const d = value as KnackDate;
    if (typeof d.unix_timestamp === 'number') return new Date(d.unix_timestamp);
    if (d.iso_timestamp) return parseDate(d.iso_timestamp);
    if (d.timestamp) return parseDate(d.timestamp);
    if (d.date) return parseDate(d.date);
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number') return parseDate(value);
  return null;
};

const parseDate = (raw: string | number): Date | null => {
  if (typeof raw === 'number') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Knack's MM/DD/YYYY is parsed as local time by Date, which is what we want
  // for a date the user picked in their own timezone.
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The end of a Date/Time *Range* field, or null if not a range. */
export const toDateRangeEnd = (value: unknown): Date | null => {
  if (!value || typeof value !== 'object') return null;
  const to = (value as KnackDate).to;
  return to ? toDate(to) : null;
};

export const toText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

export const toEmail = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return (value as KnackEmail).email ?? '';
  return '';
};

export const toLink = (value: unknown): { url: string; label: string } => {
  if (typeof value === 'string') return { url: value, label: value };
  if (value && typeof value === 'object') {
    const l = value as KnackLink;
    return { url: l.url ?? '', label: l.label ?? l.url ?? '' };
  }
  return { url: '', label: '' };
};

export const toPhone = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const p = value as KnackPhone;
    return p.formatted ?? p.full ?? p.number ?? '';
  }
  return '';
};

export const toFiles = (value: unknown): KnackFile[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((f): f is KnackFile => Boolean(f && typeof f === 'object'));
  if (typeof value === 'object') return [value as KnackFile];
  return [];
};

export const toAddress = (value: unknown): KnackAddress | null =>
  value && typeof value === 'object' ? (value as KnackAddress) : null;

/**
 * Read a field from a raw record, preferring `_raw`.
 *
 * The non-raw form is an HTML string for connection, file, email and link
 * fields — rendering it is an XSS vector, so `_raw` is always preferred and
 * the plain key is only a fallback for genuine text fields.
 */
export const rawField = (record: Record<string, unknown>, fieldKey: string): unknown => {
  const raw = record[`${fieldKey}_raw`];
  return raw === undefined ? record[fieldKey] : raw;
};
