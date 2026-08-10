import type {
  HarvestedView,
  HarvestedViews,
  KnackAppSchema,
  KnackFieldDef,
  KnackObjectDef,
} from '../types.js';
import type { EntityManifestEntry, KnackAppConfig, ViewRole } from './config.js';
import { quoteKey, singularize, toCamelCase, toPascalCase, uniquify } from './identifiers.js';

export interface ResolvedView {
  scene: string;
  view: string;
}

export interface MissingView {
  entity: string;
  role: ViewRole;
  objectName: string;
  objectKey: string;
  hint: string;
}

/** A view that resolved, but does not expose fields the manifest declares. */
export interface FieldGap {
  entity: string;
  role: ViewRole;
  view: string;
  objectName: string;
  /** Builder field names, so the message is actionable without a key lookup. */
  missing: string[];
}

/**
 * An API view that returns every record of its object to anyone whose role can
 * reach the page. Knack roles gate page access; rows are narrowed only by a
 * source connected to the logged-in user or by explicit filter criteria.
 */
export interface ScopingFinding {
  entity: string;
  role: ViewRole;
  scene: string;
  view: string;
  objectName: string;
}

export interface GenerateResult {
  code: string;
  missing: MissingView[];
  fieldGaps: FieldGap[];
  scoping: ScopingFinding[];
  warnings: string[];
  stats: { objects: number; views: number };
}

/** Knack view types that can serve each manifest role. */
const VIEW_TYPES: Record<ViewRole, string[]> = {
  list: ['table', 'search', 'list', 'grid'],
  create: ['form'],
  update: ['form', 'details'],
  delete: ['table', 'search', 'list', 'grid'],
};

/** Maps a Knack field type to the TS type of its `_raw` value. */
const tsTypeForField = (field: KnackFieldDef): string => {
  switch (field.type) {
    case 'short_text':
    case 'paragraph_text':
    case 'rich_text':
    case 'auto_increment':
    case 'signature':
      return 'string';
    case 'number':
    case 'currency':
    case 'equation':
    case 'sum':
    case 'min':
    case 'max':
    case 'average':
    case 'count':
    case 'rating':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'multiple_choice': {
      const options = field.format?.options;
      if (Array.isArray(options) && options.length > 0 && options.length <= 40) {
        const union = options.map((o) => JSON.stringify(String(o))).join(' | ');
        // Knack allows blank on non-required choice fields.
        return field.required ? union : `${union} | ''`;
      }
      return 'string';
    }
    case 'connection':
      return 'KnackConnection[]';
    case 'date_time':
      return 'KnackDate | null';
    case 'file':
    case 'image':
      return 'KnackFile | null';
    case 'email':
      return 'KnackEmail | null';
    case 'link':
      return 'KnackLink | null';
    case 'address':
      return 'KnackAddress | null';
    case 'name':
      return 'KnackName | null';
    case 'phone':
      return 'KnackPhone | null';
    case 'user_roles':
    case 'multiple_choice_multi':
      return 'string[]';
    default:
      return 'unknown';
  }
};

const findObject = (schema: KnackAppSchema, name: string): KnackObjectDef | undefined => {
  const target = name.trim().toLowerCase();
  return (
    schema.objects.find((o) => o.name.trim().toLowerCase() === target) ??
    schema.objects.find((o) => o.key === name.trim())
  );
};

/**
 * Resolve a manifest role to a real view key.
 *
 * Views are matched by source object and view type. Where a form's action is
 * reported (create vs update) it is respected; where it isn't, forms are
 * assigned in document order — hence the ambiguity warning.
 *
 * The matched view is returned alongside the reference so the caller can audit
 * what it exposes and how its records are scoped.
 */
/** How a view narrows its records, in words, for a warning a human must act on. */
const scopeLabel = (view: HarvestedView): string => {
  if (view.authenticatedUser === true) return 'the logged-in user';
  if (view.parentScoped === true) return 'a parent record';
  if (view.hasCriteria === true) return 'filter criteria';
  return 'nothing';
};

const resolveView = (
  views: HarvestedViews,
  apiPages: string[],
  objectKey: string,
  role: ViewRole,
  claimed: Set<string>,
): {
  resolved: ResolvedView | null;
  ambiguous: boolean;
  matched?: HarvestedView;
  /** Other views that matched. Populated only when the pick was by position. */
  alternatives?: Array<{ scene: string; view: string; scope: string }>;
} => {
  const pageEntries = Object.entries(views).filter(
    ([sceneKey, page]) =>
      apiPages.length === 0 ||
      apiPages.includes(sceneKey) ||
      (page.slug ? apiPages.includes(page.slug) : false),
  );

  const acceptable = VIEW_TYPES[role];
  const candidates: Array<{ scene: string; view: string; action?: string; def: HarvestedView }> = [];

  for (const [sceneKey, page] of pageEntries) {
    for (const view of page.views ?? []) {
      if (view.object !== objectKey) continue;
      if (!acceptable.includes(view.type)) continue;
      candidates.push({ scene: sceneKey, view: view.key, action: view.action, def: view });
    }
  }

  if (candidates.length === 0) return { resolved: null, ambiguous: false };

  // Prefer a form whose action matches the role outright.
  const wantedAction = role === 'create' ? ['create', 'insert', 'add'] : ['update', 'edit'];
  const byAction = candidates.find(
    (c) => c.action && wantedAction.includes(c.action.toLowerCase()) && !claimed.has(c.view),
  );
  if (byAction) {
    claimed.add(byAction.view);
    return {
      resolved: { scene: byAction.scene, view: byAction.view },
      ambiguous: false,
      matched: byAction.def,
    };
  }

  const unclaimed = candidates.filter((c) => !claimed.has(c.view));
  const pick = unclaimed[0] ?? candidates[0]!;
  claimed.add(pick.view);

  // Two indistinguishable form views for the same object: we guessed.
  const ambiguous =
    (role === 'create' || role === 'update') &&
    candidates.length > 1 &&
    candidates.every((c) => !c.action);

  /*
   * A read role with more than one candidate was also decided by position, and
   * that decision is invisible in the generated output. It matters most when
   * the candidates are scoped differently — an object listed both at top level
   * (scoped to the user) and as a child table (scoped to a parent record) is
   * ordinary in a migrated app, and picking the wrong one yields a page that
   * silently returns nothing outside its parent's context.
   */
  const alternatives =
    (role === 'list' || role === 'delete') && candidates.length > 1
      ? candidates
          .filter((c) => c.view !== pick.view)
          .map((c) => ({ scene: c.scene, view: c.view, scope: scopeLabel(c.def) }))
      : undefined;

  return {
    resolved: { scene: pick.scene, view: pick.view },
    ambiguous,
    matched: pick.def,
    ...(alternatives && alternatives.length > 0 ? { alternatives } : {}),
  };
};

/**
 * Whether a view narrows its records at all.
 *
 * Three ways it can, and missing any one of them produces a false positive:
 *
 * - `authenticatedUser` — Knack joins the source to the logged-in account.
 * - `hasCriteria` — an explicit filter is set.
 * - `parentScoped` — the view sits on a record-detail scene and follows a
 *   connection from that record. Common in migrated apps, where child tables
 *   hang off a detail page, and invisible in the view's own source.
 *
 * With none of the three, the view hands back the whole object to every role
 * that can reach the page.
 *
 * Views harvested by the legacy console snippet carry none of these flags, so a
 * `knack.views.json` predating this check is treated as scoped rather than
 * failing every build with an unanswerable question.
 */
const isScoped = (view: HarvestedView): boolean =>
  view.authenticatedUser === true ||
  view.hasCriteria === true ||
  view.parentScoped === true ||
  (view.fields === undefined && view.authenticatedUser === undefined);

const hintFor = (role: ViewRole, objectName: string): string => {
  switch (role) {
    case 'list':
    case 'delete':
      return `add a Table view for "${objectName}"`;
    case 'create':
      return `add a Form view for "${objectName}" with action "add record"`;
    case 'update':
      return `add a Form view for "${objectName}" with action "edit record"`;
  }
};

export const generate = (
  schema: KnackAppSchema,
  views: HarvestedViews,
  config: KnackAppConfig,
): GenerateResult => {
  const missing: MissingView[] = [];
  const fieldGaps: FieldGap[] = [];
  const scoping: ScopingFinding[] = [];
  const warnings: string[] = [];
  const claimed = new Set<string>();
  const allowUnscoped = new Set(config.allowUnscopedViews ?? []);

  const objectLines: string[] = [];
  const fieldBlocks: string[] = [];
  const viewBlocks: string[] = [];
  const interfaces: string[] = [];
  let viewCount = 0;

  const entities = Object.entries(config.entities) as Array<[string, EntityManifestEntry]>;

  for (const [entityName, manifest] of entities) {
    const object = findObject(schema, manifest.object);

    if (!object) {
      warnings.push(
        `Entity "${entityName}" references object "${manifest.object}", which does not exist ` +
          `in the Knack app. Check the spelling, or create it via the MCP.`,
      );
      continue;
    }

    objectLines.push(`  ${quoteKey(entityName)}: '${object.key}',`);

    // ── FIELDS ────────────────────────────────────────────────────────────
    const takenFieldNames = new Set<string>();
    const fieldLines: string[] = [];
    const interfaceLines: string[] = [];

    for (const field of object.fields ?? []) {
      const base = toCamelCase(field.name);
      if (!base) {
        warnings.push(
          `Field ${field.key} on "${object.name}" has a name that yields no valid identifier ` +
            `(${JSON.stringify(field.name)}); skipped.`,
        );
        continue;
      }
      const identifier = uniquify(base, takenFieldNames);
      if (identifier !== base) {
        warnings.push(
          `"${object.name}" has more than one field named "${field.name}"; ` +
            `${field.key} was generated as "${identifier}".`,
        );
      }

      fieldLines.push(`    ${quoteKey(identifier)}: '${field.key}',`);
      const optional = field.required ? '' : '?';
      interfaceLines.push(`  ${quoteKey(identifier)}${optional}: ${tsTypeForField(field)};`);
    }

    fieldBlocks.push(`  ${quoteKey(entityName)}: {\n${fieldLines.join('\n')}\n  },`);

    const interfaceName = toPascalCase(singularize(entityName));
    interfaces.push(
      `export interface ${interfaceName} {\n  id: string;\n${interfaceLines.join('\n')}\n}`,
    );

    // ── VIEWS ─────────────────────────────────────────────────────────────
    const viewLines: string[] = [];
    const pages = manifest.pages ?? config.apiPages;

    // Manifest field names -> Knack keys, for the per-view exposure check.
    const requiredFields = (manifest.fields ?? []).map((name) => {
      const target = name.trim().toLowerCase();
      const field = (object.fields ?? []).find(
        (f) => f.name.trim().toLowerCase() === target || f.key === name.trim(),
      );
      if (!field) {
        warnings.push(
          `Entity "${entityName}" declares field "${name}", which does not exist on ` +
            `"${object.name}". Check the spelling against the Builder.`,
        );
      }
      return { name, key: field?.key };
    });

    for (const role of manifest.views) {
      const { resolved, ambiguous, matched, alternatives } = resolveView(
        views,
        pages,
        object.key,
        role,
        claimed,
      );
      if (!resolved) {
        missing.push({
          entity: entityName,
          role,
          objectName: object.name,
          objectKey: object.key,
          hint: hintFor(role, object.name),
        });
        continue;
      }
      if (ambiguous) {
        warnings.push(
          `"${entityName}.${role}" resolved to ${resolved.view} by position — the Knack app has ` +
            `multiple form views for "${object.name}" and no action was reported for them. ` +
            `Verify it is the right one.`,
        );
      }

      if (alternatives) {
        warnings.push(
          `"${entityName}.${role}" resolved to ${resolved.view} (scoped by ` +
            `${matched ? scopeLabel(matched) : 'nothing'}) by position. "${object.name}" also has ` +
            alternatives.map((a) => `${a.view} on ${a.scene} (scoped by ${a.scope})`).join(', ') +
            `. Pin the intended one with \`pages\` on the "${entityName}" manifest entry — ` +
            `views scoped differently return different records.`,
        );
      }

      // A field left off the view is absent from the API response, not null.
      if (matched?.fields && requiredFields.length > 0) {
        const exposed = new Set(matched.fields);
        const gaps = requiredFields
          .filter((f) => f.key && !exposed.has(f.key))
          .map((f) => f.name);
        if (gaps.length > 0) {
          fieldGaps.push({
            entity: entityName,
            role,
            view: resolved.view,
            objectName: object.name,
            missing: gaps,
          });
        }
      }

      // Reads that return the whole object to every role holding the page.
      if (
        matched &&
        (role === 'list' || role === 'delete') &&
        !isScoped(matched) &&
        !allowUnscoped.has(resolved.view)
      ) {
        scoping.push({
          entity: entityName,
          role,
          scene: resolved.scene,
          view: resolved.view,
          objectName: object.name,
        });
      }

      viewLines.push(
        `    ${quoteKey(role)}: { scene: '${resolved.scene}', view: '${resolved.view}' },`,
      );
      viewCount++;
    }

    if (viewLines.length > 0) {
      viewBlocks.push(`  ${quoteKey(entityName)}: {\n${viewLines.join('\n')}\n  },`);
    }
  }

  const roleLines = Object.entries(config.roles ?? {}).map(
    ([profileKey, role]) => `  ${quoteKey(profileKey)}: '${role}',`,
  );

  const code = `// AUTO-GENERATED by \`npm run knack:sync\`. Do not edit.
//
// Source app: ${schema.name} (${schema.id})
// ${schema.objects.length} objects in the app · ${entities.length} entities mapped · ${viewCount} views resolved
//
// Objects, fields, scenes and views all come from the Knack loader endpoint,
// which is unauthenticated — so this regenerates in CI with no secrets.

import type {
  KnackAddress,
  KnackConnection,
  KnackDate,
  KnackEmail,
  KnackFile,
  KnackLink,
  KnackName,
  KnackPhone,
  KnackViewRef,
} from '@fmc/knack-core';

export const OBJECTS = {
${objectLines.join('\n')}
} as const;

export const FIELDS = {
${fieldBlocks.join('\n')}
} as const;

export const VIEWS: Record<string, Partial<Record<'list' | 'create' | 'update' | 'delete', KnackViewRef>>> = {
${viewBlocks.join('\n')}
};

${roleLines.length > 0 ? `export const ROLE_MAP = {\n${roleLines.join('\n')}\n} as const;\n\nexport type AppRole = (typeof ROLE_MAP)[keyof typeof ROLE_MAP];\n` : ''}
${interfaces.join('\n\n')}
`;

  return {
    code,
    missing,
    fieldGaps,
    scoping,
    warnings,
    stats: { objects: entities.length, views: viewCount },
  };
};
