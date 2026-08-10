import type { KnackFilter, KnackFilterGroup } from './types.js';

/**
 * Knack's filter API requires dates as MM/DD/YYYY.
 *
 * This matters more than it looks: an ISO date does not error, it silently
 * matches zero records. Every filter value passes through here.
 */
export const toKnackDate = (value: Date | string): string => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${value.getFullYear()}`;
  }

  // YYYY-MM-DDTHH:mm:ss... or YYYY-MM-DD
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;

  return value;
};

const serializeValue = (value: KnackFilter['value']): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return toKnackDate(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return toKnackDate(value);
};

/** Operators that take no value; sending one makes Knack return nothing. */
const VALUELESS_OPERATORS = new Set(['is blank', 'is not blank']);

export const buildFilterGroup = (
  filters: KnackFilter[] | KnackFilterGroup | undefined,
): KnackFilterGroup | null => {
  if (!filters) return null;
  const group: KnackFilterGroup = Array.isArray(filters)
    ? { match: 'and', rules: filters }
    : filters;
  if (group.rules.length === 0) return null;
  return group;
};

/** Serialize to the JSON string Knack expects in the `filters` query param. */
export const serializeFilters = (
  filters: KnackFilter[] | KnackFilterGroup | undefined,
): string | null => {
  const group = buildFilterGroup(filters);
  if (!group) return null;

  return JSON.stringify({
    match: group.match,
    rules: group.rules.map((rule) =>
      VALUELESS_OPERATORS.has(rule.operator)
        ? { field: rule.field, operator: rule.operator }
        : { field: rule.field, operator: rule.operator, value: serializeValue(rule.value) },
    ),
  });
};

/** Small fluent helper so callers rarely hand-build rule objects. */
export const where = {
  is: (field: string, value: KnackFilter['value']): KnackFilter => ({ field, operator: 'is', value }),
  isNot: (field: string, value: KnackFilter['value']): KnackFilter => ({ field, operator: 'is not', value }),
  contains: (field: string, value: string): KnackFilter => ({ field, operator: 'contains', value }),
  startsWith: (field: string, value: string): KnackFilter => ({ field, operator: 'starts with', value }),
  blank: (field: string): KnackFilter => ({ field, operator: 'is blank' }),
  notBlank: (field: string): KnackFilter => ({ field, operator: 'is not blank' }),
  before: (field: string, value: Date | string): KnackFilter => ({ field, operator: 'is before', value }),
  after: (field: string, value: Date | string): KnackFilter => ({ field, operator: 'is after', value }),
  higherThan: (field: string, value: number): KnackFilter => ({ field, operator: 'higher than', value }),
  lowerThan: (field: string, value: number): KnackFilter => ({ field, operator: 'lower than', value }),
  /** Connection fields filter on the connected record's id with `is`. */
  connectedTo: (field: string, recordId: string): KnackFilter => ({ field, operator: 'is', value: recordId }),
} as const;
