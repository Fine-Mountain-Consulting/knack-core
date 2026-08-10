/**
 * Turns the application definition's `scenes` into the flat view map the
 * codegen resolves against.
 *
 * The loader endpoint returns scenes and their views alongside the objects
 * (see `src/schema.ts`), so this is a pure transform — no second request, no
 * API key, no browser. `knack.views.json` exists only as an offline fallback.
 */
import type {
  HarvestedPage,
  HarvestedView,
  HarvestedViews,
  KnackSceneDef,
  KnackViewDef,
} from '../types.js';

/** Property names whose array values may hold nested columns or inputs. */
const NESTED_KEYS = new Set(['columns', 'inputs', 'groups', 'rows']);

/**
 * Collect every `field.key` reachable from a view's layout.
 *
 * Knack nests these differently per view type — a table is `columns[]`, a form
 * is `groups[].columns[].inputs[]`, and grouped tables add another level — and
 * the depth has changed across Knack versions. Walking tolerantly is more
 * durable than indexing a shape that is not contractual. The walk is confined
 * to layout subtrees so a `source.connection_key` never leaks in.
 */
const collectFieldKeys = (node: unknown, out: Set<string>, depth = 0): void => {
  if (depth > 8 || node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) collectFieldKeys(item, out, depth + 1);
    return;
  }

  const record = node as Record<string, unknown>;

  const field = record.field;
  if (typeof field === 'string' && field.startsWith('field_')) {
    out.add(field);
  } else if (field && typeof field === 'object') {
    const key = (field as { key?: unknown }).key;
    if (typeof key === 'string' && key.startsWith('field_')) out.add(key);
  }

  for (const [key, value] of Object.entries(record)) {
    if (NESTED_KEYS.has(key) && Array.isArray(value)) {
      collectFieldKeys(value, out, depth + 1);
    }
  }
};

/** Field keys a view exposes, in a stable order so generated output diffs cleanly. */
export const viewFieldKeys = (view: KnackViewDef): string[] => {
  const keys = new Set<string>();
  collectFieldKeys(view.columns, keys);
  collectFieldKeys(view.inputs, keys);
  collectFieldKeys(view.groups, keys);
  return [...keys].sort(
    (a, b) => Number(a.slice('field_'.length)) - Number(b.slice('field_'.length)),
  );
};

/**
 * Whether the view's source carries at least one filter rule.
 *
 * Knack writes an empty `criteria: { match, rules: [], groups: [] }` on every
 * view, so the presence of `criteria` proves nothing — only a non-empty
 * `rules` array narrows the record set.
 */
const sourceHasCriteria = (view: KnackViewDef): boolean => {
  const rules = view.source?.criteria?.rules;
  return Array.isArray(rules) && rules.length > 0;
};

/**
 * Whether the view is narrowed by the record its scene is keyed on.
 *
 * A detail scene carries an `object`; a view on it naming a `connection_key`
 * shows only rows connected to that record. Knack expresses this with neither
 * `authenticated_user` nor criteria, so it is indistinguishable from a wide
 * open view unless the scene is consulted — which is why this takes both.
 */
export const isParentScoped = (scene: KnackSceneDef, view: KnackViewDef): boolean =>
  Boolean(scene.object) && Boolean(view.source?.connection_key);

const toHarvestedView = (scene: KnackSceneDef, view: KnackViewDef): HarvestedView => {
  const fields = viewFieldKeys(view);
  const entry: HarvestedView = {
    key: view.key,
    type: view.type,
  };

  if (view.name) entry.name = view.name;
  if (view.source?.object) entry.object = view.source.object;
  if (view.action) entry.action = view.action;
  if (fields.length > 0) entry.fields = fields;
  if (view.source?.authenticated_user === true) entry.authenticatedUser = true;
  if (sourceHasCriteria(view)) entry.hasCriteria = true;
  if (isParentScoped(scene, view)) entry.parentScoped = true;

  return entry;
};

/**
 * Normalize scenes into `HarvestedViews`, keyed by scene key.
 *
 * Key order follows the app definition so repeated runs produce identical
 * `knack.views.json` and the file diffs cleanly in review.
 */
export const scenesToViews = (scenes: KnackSceneDef[]): HarvestedViews => {
  const out: HarvestedViews = {};

  for (const scene of scenes) {
    if (!scene?.key) continue;

    const page: HarvestedPage = {
      views: (scene.views ?? []).filter((v) => v?.key).map((v) => toHarvestedView(scene, v)),
    };

    if (scene.slug) page.slug = scene.slug;
    if (scene.name) page.name = scene.name;
    if (scene.authenticated === true) page.authenticated = true;

    out[scene.key] = page;
  }

  return out;
};

export const countViews = (views: HarvestedViews): number =>
  Object.values(views).reduce((n, page) => n + (page.views?.length ?? 0), 0);
