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
  /** True on user-role objects — the Accounts table and each role table. */
  user?: boolean;
  /** Present on user-role objects. Maps to a login's `allowed_profiles`. */
  profile_key?: string;
  type?: string;
}

/**
 * A view's data source. `authenticated_user` is the one that matters for
 * security: when true, Knack scopes the view's records to the logged-in user
 * through `connection_key`. When it is absent and `criteria.rules` is empty,
 * the view returns **every record of the object** to anyone whose role can
 * reach the page — Knack roles gate the page, not the rows.
 */
export interface KnackViewSource {
  object?: string;
  authenticated_user?: boolean;
  connection_key?: string;
  relationship_type?: string;
  criteria?: { match?: string; rules?: unknown[]; groups?: unknown[] };
  sort?: Array<{ field?: string; order?: string }>;
  limit?: string | number;
  type?: string;
}

/** A field reference on a column or input: `{ key }`, or the key itself. */
export type KnackFieldRef = { key?: string } | string | null | undefined;

/** A column on a table or details view. Grouped layouts nest one level down. */
export interface KnackViewColumn {
  field?: KnackFieldRef;
  header?: string;
  type?: string;
  columns?: KnackViewColumn[][];
}

/** An input on a form view. */
export interface KnackViewInput {
  field?: KnackFieldRef;
  label?: string;
  type?: string;
  required?: boolean;
}

export interface KnackViewDef {
  key: string;
  name?: string;
  type: string;
  title?: string;
  action?: string;
  source?: KnackViewSource;
  columns?: KnackViewColumn[];
  inputs?: KnackViewInput[];
  /**
   * Form views nest their inputs under groups → columns → inputs. Knack has
   * shipped more than one nesting depth here, so read these with the tolerant
   * walker in `cli/scenes.ts` rather than indexing directly.
   */
  groups?: Array<{ columns?: Array<{ inputs?: KnackViewInput[] }> }>;
  links?: unknown[];
  rules?: Record<string, unknown>;
  /** Set when the view is restricted to specific role profiles. */
  allowed_profiles?: string[] | null;
  limit_profile_access?: boolean | null;
}

export interface KnackSceneDef {
  key: string;
  name?: string;
  slug?: string;
  parent?: string | null;
  /** Set when the scene is keyed on a record — a detail page. See `parentScoped`. */
  object?: string | null;
  /** Whether the scene requires a logged-in user. */
  authenticated?: boolean | null;
  /** Role profile keys allowed to reach this scene, when restricted. */
  authentication_profiles?: string[] | null;
  allowed_profiles?: string[] | null;
  limit_profile_access?: boolean | null;
  modal?: boolean | null;
  rules?: unknown;
  views?: KnackViewDef[];
}

export interface KnackAppSchema {
  id: string;
  name: string;
  objects: KnackObjectDef[];
  /**
   * Scenes and their views, from the same unauthenticated response as the
   * objects. Empty only when reading a truncated or hand-written fixture.
   */
  scenes: KnackSceneDef[];
}

// ── Views (derived from the schema, or read from knack.views.json) ──────────

export interface HarvestedView {
  key: string;
  type: string;
  name?: string;
  /** Source object key, when the view has one. */
  object?: string;
  /** For form views: 'create' | 'update' | 'insert' etc, as Knack reports it. */
  action?: string;
  /**
   * Field keys this view actually exposes — table columns or form inputs.
   * A field absent here is absent from the API response, which is the most
   * common cause of an unexpected `undefined` in a component.
   */
  fields?: string[];
  /** Whether the source is scoped to the logged-in user. */
  authenticatedUser?: boolean;
  /** Whether the source carries at least one criteria rule. */
  hasCriteria?: boolean;
  /**
   * Whether the view is scoped to the record its scene is keyed on.
   *
   * A record-detail scene carries an `object`, and a view on it that names a
   * `connection_key` shows only the rows connected to *that* record — the
   * child tables on a "recipe details" page, say. Such a view has neither
   * `authenticated_user` nor criteria and is nonetheless properly narrowed;
   * counting it as unscoped is a false positive, and an expensive one, because
   * it pushes real leaks into `allowUnscopedViews` alongside the noise.
   */
  parentScoped?: boolean;
}

export interface HarvestedPage {
  slug?: string;
  name?: string;
  /** Whether the scene requires a logged-in user. */
  authenticated?: boolean;
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
