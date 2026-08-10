/**
 * Read-only crawl of a Knack app, as one or more real logged-in users.
 *
 * The premise: an existing Knack app already *is* an API. Every table, list and
 * search view its users navigate is a `GET /pages/{scene}/views/{view}/records`
 * endpoint, reachable with nothing but the app id and a user's own credentials.
 * No REST API key, no Builder access, no views created for our benefit.
 *
 * That matters for migration work in two ways:
 *
 *   1. The app definition (see `src/schema.ts`) says which fields a view is
 *      *configured* to expose. Only a crawl says what actually comes back —
 *      whether a scope returns rows for this user, whether a system field like
 *      `Owned By` is populated, what a connection value really looks like.
 *   2. Knack keeps enforcing roles and record rules throughout, because every
 *      request is made as a genuine logged-in user. Nothing here bypasses
 *      authorization, so nothing here has to reimplement it.
 *
 * The crawl issues **GET requests only**. It runs against live client data,
 * where a write would fire the app's record rules and cause real side effects.
 */
import { KnackError } from '../errors.js';
import type { KnackSceneDef, KnackViewDef, KnackAppSchema } from '../types.js';
import type { KnackViewClient } from '../viewClient.js';
import { viewFieldKeys } from './scenes.js';

/**
 * View types that answer the collection endpoint.
 *
 * Deliberately conservative. Types outside this set are reported as skipped
 * rather than dropped, so the report never implies coverage it did not attempt.
 */
export const LISTABLE_TYPES = new Set(['table', 'list', 'search']);

/** Views addressed per-record; sampled with an id borrowed from a list view. */
export const DETAIL_TYPES = new Set(['details']);

export type CrawlStatus = 'ok' | 'empty' | 'forbidden' | 'not-found' | 'error';

export interface CrawlTarget {
  scene: string;
  sceneSlug?: string;
  sceneName?: string;
  /** Child scenes render under a parent record, which affects how to read an empty result. */
  parent?: string | null;
  authenticated: boolean;
  view: string;
  viewName?: string;
  viewType: string;
  object: string;
  /** Field keys the definition says this view exposes. */
  declaredFields: string[];
  /** Whether the source is scoped to the logged-in user or carries criteria. */
  scoped: boolean;
}

export interface SkippedView {
  scene: string;
  view: string;
  viewType: string;
  object?: string;
  reason: 'not-listable' | 'no-source-object';
}

export interface CrawlPlan {
  targets: CrawlTarget[];
  details: CrawlTarget[];
  /**
   * Form views. Never crawled — a POST or PUT against a live app fires its
   * record rules — but they are still part of the app's API surface, and they
   * expose fields no table does. Counted in coverage so the report does not
   * imply the app exposes less than it does.
   */
  writeViews: CrawlTarget[];
  skipped: SkippedView[];
}

export interface CrawlAttempt {
  scene: string;
  view: string;
  viewType: string;
  object: string;
  status: CrawlStatus;
  httpStatus?: number;
  /** Knack's reported total for the view, which can exceed the sampled count. */
  totalRecords?: number;
  sampled: number;
  /** Field keys actually present on the returned records. */
  fields: string[];
  /** Declared by the view but absent from every sampled record. */
  absent: string[];
  /** Present in the payload but not declared by the view's layout. */
  undeclared: string[];
  message?: string;
  /** Only populated with --values. Real record data; treat as client-confidential. */
  samples?: unknown[];
}

export interface AccountCrawl {
  label: string;
  email: string;
  userId: string;
  profileKeys: string[];
  attempts: CrawlAttempt[];
  error?: string;
}

const sourceScoped = (view: KnackViewDef): boolean => {
  if (view.source?.authenticated_user === true) return true;
  const rules = view.source?.criteria?.rules;
  return Array.isArray(rules) && rules.length > 0;
};

/**
 * Turn the app definition into a list of endpoints worth trying.
 *
 * Every view with a source object is accounted for — either as a target, a
 * detail target, or an explicit skip. Nothing is silently omitted.
 */
export const planCrawl = (scenes: KnackSceneDef[]): CrawlPlan => {
  const targets: CrawlTarget[] = [];
  const details: CrawlTarget[] = [];
  const writeViews: CrawlTarget[] = [];
  const skipped: SkippedView[] = [];

  for (const scene of scenes) {
    for (const view of scene.views ?? []) {
      if (!view?.key) continue;

      const object = view.source?.object;
      if (!object) {
        skipped.push({
          scene: scene.key,
          view: view.key,
          viewType: view.type,
          reason: 'no-source-object',
        });
        continue;
      }

      const target: CrawlTarget = {
        scene: scene.key,
        sceneSlug: scene.slug,
        sceneName: scene.name,
        parent: scene.parent ?? null,
        authenticated: scene.authenticated === true,
        view: view.key,
        viewName: view.name,
        viewType: view.type,
        object,
        declaredFields: viewFieldKeys(view),
        scoped: sourceScoped(view),
      };

      if (LISTABLE_TYPES.has(view.type)) targets.push(target);
      else if (DETAIL_TYPES.has(view.type)) details.push(target);
      else if (view.type === 'form') writeViews.push(target);
      else
        skipped.push({
          scene: scene.key,
          view: view.key,
          viewType: view.type,
          object,
          reason: 'not-listable',
        });
    }
  }

  return { targets, details, writeViews, skipped };
};

/** Field keys actually present on a set of raw records, `field_N` order. */
export const recordFieldKeys = (records: unknown[]): string[] => {
  const keys = new Set<string>();
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    for (const key of Object.keys(record as Record<string, unknown>)) {
      // `field_1_raw` is the same field, reported twice.
      const base = key.endsWith('_raw') ? key.slice(0, -'_raw'.length) : key;
      if (/^field_\d+$/.test(base)) keys.add(base);
    }
  }
  return [...keys].sort(
    (a, b) => Number(a.slice('field_'.length)) - Number(b.slice('field_'.length)),
  );
};

const classify = (error: unknown): { status: CrawlStatus; httpStatus?: number; message: string } => {
  if (error instanceof KnackError) {
    if (error.isAuthError)
      return { status: 'forbidden', httpStatus: error.status, message: error.message };
    if (error.isNotFound)
      return { status: 'not-found', httpStatus: error.status, message: error.message };
    return { status: 'error', httpStatus: error.status, message: error.message };
  }
  return { status: 'error', message: error instanceof Error ? error.message : String(error) };
};

const compare = (target: CrawlTarget, fields: string[]) => ({
  absent: target.declaredFields.filter((f) => !fields.includes(f)),
  undeclared: fields.filter((f) => !target.declaredFields.includes(f)),
});

export interface CrawlOptions {
  /** Records to request per view. Small by design — this is a sample, not an export. */
  rows?: number;
  /** Persist real record values into the report. Off by default. */
  includeValues?: boolean;
  /** Called before each request, for progress output. */
  onProgress?: (target: CrawlTarget, index: number, total: number) => void;
}

/**
 * Crawl every planned target as one account.
 *
 * Sequential on purpose: the rate limiter is per application and shared across
 * accounts, so firing these in parallel buys nothing and makes a client's live
 * app slower for its real users while we look at it.
 */
export const crawlTargets = async (
  client: KnackViewClient,
  plan: CrawlPlan,
  options: CrawlOptions = {},
): Promise<CrawlAttempt[]> => {
  const rows = options.rows ?? 3;
  const attempts: CrawlAttempt[] = [];
  /** A record id per object, reused to sample detail views. */
  const recordIds = new Map<string, string>();

  const all = [...plan.targets, ...plan.details];

  for (const [index, target] of plan.targets.entries()) {
    options.onProgress?.(target, index, all.length);

    try {
      const result = await client.list<Record<string, unknown>>(
        { scene: target.scene, view: target.view },
        { rowsPerPage: rows },
      );
      const fields = recordFieldKeys(result.records);

      const first = result.records[0];
      const id = first && typeof first.id === 'string' ? first.id : undefined;
      if (id && !recordIds.has(target.object)) recordIds.set(target.object, id);

      attempts.push({
        scene: target.scene,
        view: target.view,
        viewType: target.viewType,
        object: target.object,
        status: result.records.length > 0 ? 'ok' : 'empty',
        totalRecords: result.totalRecords,
        sampled: result.records.length,
        fields,
        ...compare(target, fields),
        ...(options.includeValues ? { samples: result.records } : {}),
      });
    } catch (error) {
      attempts.push({
        scene: target.scene,
        view: target.view,
        viewType: target.viewType,
        object: target.object,
        sampled: 0,
        fields: [],
        absent: target.declaredFields,
        undeclared: [],
        ...classify(error),
      });
    }
  }

  /*
   * Detail views second, because they need a record id and the list pass is
   * what produces one. A detail view usually exposes far more of an object than
   * any table does, so this is where field coverage is won.
   */
  for (const [offset, target] of plan.details.entries()) {
    const id = recordIds.get(target.object);
    options.onProgress?.(target, plan.targets.length + offset, all.length);

    if (!id) {
      attempts.push({
        scene: target.scene,
        view: target.view,
        viewType: target.viewType,
        object: target.object,
        status: 'empty',
        sampled: 0,
        fields: [],
        absent: target.declaredFields,
        undeclared: [],
        message: 'No record id available for this object — no list view returned a row.',
      });
      continue;
    }

    try {
      const record = await client.get<Record<string, unknown>>(
        { scene: target.scene, view: target.view },
        id,
      );
      const fields = recordFieldKeys([record]);
      attempts.push({
        scene: target.scene,
        view: target.view,
        viewType: target.viewType,
        object: target.object,
        status: fields.length > 0 ? 'ok' : 'empty',
        sampled: fields.length > 0 ? 1 : 0,
        fields,
        ...compare(target, fields),
        ...(options.includeValues ? { samples: [record] } : {}),
      });
    } catch (error) {
      attempts.push({
        scene: target.scene,
        view: target.view,
        viewType: target.viewType,
        object: target.object,
        sampled: 0,
        fields: [],
        absent: target.declaredFields,
        undeclared: [],
        ...classify(error),
      });
    }
  }

  return attempts;
};

export interface ObjectCoverage {
  key: string;
  name: string;
  totalFields: number;
  /** Fields exposed by a readable view — the crawlable surface. */
  declaredRead: number;
  /** Fields exposed by any existing view, forms included — the full API surface. */
  declaredAll: number;
  /** Fields that actually arrived in a payload. */
  observed: number;
  /** Readable somewhere but never seen — usually a view no account could reach. */
  unreached: string[];
  reachable: boolean;
}

/**
 * Field-level coverage per object, union across every account.
 *
 * Three numbers, because conflating them misleads in opposite directions:
 *
 *   `declaredAll`  — every field some existing view touches, forms included.
 *                    This is what the app's own views could carry, and the
 *                    right figure for judging whether a migration can read and
 *                    write everything it needs through them.
 *   `declaredRead` — the subset on views a crawl may safely call. Always lower,
 *                    because forms are excluded by design.
 *   `observed`     — what a real request actually returned. The gap against
 *                    `declaredRead` is views no supplied account could reach,
 *                    or that held no rows for anyone.
 */
export const objectCoverage = (
  schema: KnackAppSchema,
  plan: CrawlPlan,
  accounts: AccountCrawl[],
): ObjectCoverage[] => {
  const declaredBy = new Map<string, Set<string>>();
  for (const target of [...plan.targets, ...plan.details]) {
    const set = declaredBy.get(target.object) ?? new Set<string>();
    target.declaredFields.forEach((f) => set.add(f));
    declaredBy.set(target.object, set);
  }

  const declaredAllBy = new Map<string, Set<string>>();
  for (const target of [...plan.targets, ...plan.details, ...plan.writeViews]) {
    const set = declaredAllBy.get(target.object) ?? new Set<string>();
    target.declaredFields.forEach((f) => set.add(f));
    declaredAllBy.set(target.object, set);
  }

  const observedBy = new Map<string, Set<string>>();
  for (const account of accounts) {
    for (const attempt of account.attempts) {
      const set = observedBy.get(attempt.object) ?? new Set<string>();
      attempt.fields.forEach((f) => set.add(f));
      observedBy.set(attempt.object, set);
    }
  }

  return schema.objects.map((object) => {
    const fields = (object.fields ?? []).map((f) => f.key);
    const declaredRead = declaredBy.get(object.key) ?? new Set<string>();
    const declaredAll = declaredAllBy.get(object.key) ?? new Set<string>();
    const observed = observedBy.get(object.key) ?? new Set<string>();

    return {
      key: object.key,
      name: object.name ?? object.key,
      totalFields: fields.length,
      declaredRead: fields.filter((f) => declaredRead.has(f)).length,
      declaredAll: fields.filter((f) => declaredAll.has(f)).length,
      observed: fields.filter((f) => observed.has(f)).length,
      unreached: [...declaredRead].filter((f) => !observed.has(f)),
      reachable: observed.size > 0,
    };
  });
};

/** Role profile keys defined in the app but not covered by any supplied account. */
export const uncoveredProfiles = (
  schema: KnackAppSchema,
  accounts: AccountCrawl[],
): Array<{ profileKey: string; name: string }> => {
  const covered = new Set(accounts.flatMap((a) => a.profileKeys));
  return schema.objects
    .filter((o) => o.user === true && typeof o.profile_key === 'string')
    .map((o) => ({ profileKey: o.profile_key as string, name: o.name ?? o.key }))
    .filter((role) => !covered.has(role.profileKey));
};
