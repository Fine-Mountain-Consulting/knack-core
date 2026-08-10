import type {
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

export interface GenerateResult {
  code: string;
  missing: MissingView[];
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
 * Knack does not expose view metadata over REST, so this matches harvested
 * views by source object and view type. Where a form's action is reported
 * (create vs update) it is respected; where it isn't, forms are assigned in
 * document order — hence the ambiguity warning.
 */
const resolveView = (
  views: HarvestedViews,
  apiPages: string[],
  objectKey: string,
  role: ViewRole,
  claimed: Set<string>,
): { resolved: ResolvedView | null; ambiguous: boolean } => {
  const pageEntries = Object.entries(views).filter(
    ([sceneKey, page]) =>
      apiPages.length === 0 ||
      apiPages.includes(sceneKey) ||
      (page.slug ? apiPages.includes(page.slug) : false),
  );

  const acceptable = VIEW_TYPES[role];
  const candidates: Array<{ scene: string; view: string; action?: string }> = [];

  for (const [sceneKey, page] of pageEntries) {
    for (const view of page.views ?? []) {
      if (view.object !== objectKey) continue;
      if (!acceptable.includes(view.type)) continue;
      candidates.push({ scene: sceneKey, view: view.key, action: view.action });
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
    return { resolved: { scene: byAction.scene, view: byAction.view }, ambiguous: false };
  }

  const unclaimed = candidates.filter((c) => !claimed.has(c.view));
  const pick = unclaimed[0] ?? candidates[0]!;
  claimed.add(pick.view);

  // Two indistinguishable form views for the same object: we guessed.
  const ambiguous =
    (role === 'create' || role === 'update') &&
    candidates.length > 1 &&
    candidates.every((c) => !c.action);

  return { resolved: { scene: pick.scene, view: pick.view }, ambiguous };
};

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
  const warnings: string[] = [];
  const claimed = new Set<string>();

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

    for (const role of manifest.views) {
      const { resolved, ambiguous } = resolveView(views, pages, object.key, role, claimed);
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
            `multiple form views for "${object.name}" and the harvest reported no action for ` +
            `them. Verify it is the right one.`,
        );
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
// Objects and fields come from the Knack loader endpoint. Views come from
// knack.views.json, captured by \`npm run knack:harvest\` — Knack publishes no
// REST endpoint for view keys.

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
    warnings,
    stats: { objects: entities.length, views: viewCount },
  };
};
