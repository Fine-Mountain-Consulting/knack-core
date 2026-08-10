/**
 * Knack wire types.
 *
 * Knack returns complex fields twice: `field_x` is a formatted display string
 * (HTML for several types) and `field_x_raw` is the structured value. Always
 * read `_raw` for anything that is not plain text — see the blueprint §3.2.
 */

/** A connection field's raw value. Always an array on read, even for 1:1. */
export interface KnackConnection {
  id: string;
  /** The connected record's display field. A label — not stable, do not key off it. */
  identifier: string;
}

export interface KnackFile {
  id: string;
  url: string;
  filename: string;
  size?: number;
  type?: string;
  thumb_url?: string;
  public_url?: string;
}

export interface KnackEmail {
  email: string;
  label?: string;
}

export interface KnackLink {
  url: string;
  label?: string;
}

export interface KnackName {
  first: string;
  last: string;
  title?: string;
  middle?: string;
}

export interface KnackPhone {
  formatted: string;
  full?: string;
  number?: string;
  area?: string;
}

export interface KnackAddress {
  street?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

/** Knack's raw date shape. `iso_timestamp` is present on most, but not all, tenants. */
export interface KnackDate {
  date?: string;
  date_formatted?: string;
  hours?: number | string;
  minutes?: number | string;
  am_pm?: string;
  unix_timestamp?: number;
  iso_timestamp?: string;
  timestamp?: string;
  /** Present on Date/Time *Range* fields. */
  to?: Omit<KnackDate, 'to'>;
}

/**
 * A connection value as it may actually arrive: Knack is inconsistent across
 * field configurations and API surfaces, so normalize rather than trust.
 */
export type KnackConnectionValue =
  | KnackConnection[]
  | string
  | null
  | undefined;

/** A raw record straight off the wire, before typed mapping. */
export type KnackRawRecord = { id: string } & Record<string, unknown>;

// ── Queries ─────────────────────────────────────────────────────────────────

export type KnackOperator =
  | 'is'
  | 'is not'
  | 'contains'
  | 'does not contain'
  | 'starts with'
  | 'ends with'
  | 'is blank'
  | 'is not blank'
  | 'is before'
  | 'is after'
  | 'is during the current'
  | 'higher than'
  | 'lower than';

export interface KnackFilter {
  field: string;
  operator: KnackOperator;
  /** Dates are normalized to Knack's required MM/DD/YYYY on serialization. */
  value?: string | number | boolean | Date | null;
}

export interface KnackFilterGroup {
  match: 'and' | 'or';
  rules: KnackFilter[];
}

export interface KnackListOptions {
  filters?: KnackFilter[] | KnackFilterGroup;
  page?: number;
  /** Knack caps this at 1000. */
  rowsPerPage?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  signal?: AbortSignal;
}

export interface KnackListResponse<T> {
  records: T[];
  totalPages: number;
  currentPage: number;
  totalRecords: number;
}

/** Identifies a view-based endpoint. Generated into `VIEWS` by knack-sync. */
export interface KnackViewRef {
  scene: string;
  view: string;
}

// ── Schema (from the loader endpoint) ───────────────────────────────────────

export interface KnackFieldDef {
  key: string;
  name: string;
  type: string;
  required?: boolean;
  /** Multiple-choice options live here, under `options`. */
  format?: Record<string, unknown> & { options?: string[] };
  relationship?: { object?: string; has?: string; belongs_to?: string };
}

export interface KnackObjectDef {
  key: string;
  name: string;
  fields: KnackFieldDef[];
  identifier?: string;
  /** Present on user-role objects. */
  profile_key?: string;
  type?: string;
}

export interface KnackAppSchema {
  id: string;
  name: string;
  objects: KnackObjectDef[];
}

// ── Harvested views (from knack.views.json) ─────────────────────────────────

export interface HarvestedView {
  key: string;
  type: string;
  name?: string;
  /** Source object key, when the view has one. */
  object?: string;
  /** For form views: 'create' | 'update' | 'insert' etc, as Knack reports it. */
  action?: string;
}

export interface HarvestedPage {
  slug?: string;
  name?: string;
  views: HarvestedView[];
}

export type HarvestedViews = Record<string, HarvestedPage>;

// ── Session ─────────────────────────────────────────────────────────────────

export interface KnackUser {
  id: string;
  email: string;
  name?: string;
  token: string;
  /** Role object keys, e.g. ['object_5']. The authorization source of truth. */
  profileKeys: string[];
  approvalStatus?: string;
  values?: Record<string, unknown>;
}
