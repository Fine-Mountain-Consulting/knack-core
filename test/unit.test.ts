import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeFilters, toKnackDate, where } from '../dist/index.js';
import {
  connectionIds,
  matchesAny,
  toDate,
  toDateRangeEnd,
  toNumber,
  rawField,
  valueToStrings,
} from '../dist/index.js';
import { singularize, toCamelCase, toPascalCase, uniquify } from '../dist/cli/index.js';
import { generate } from '../dist/cli/index.js';
import type { KnackAppSchema, HarvestedViews } from '../dist/index.js';
import type { KnackAppConfig } from '../dist/cli/index.js';

// ── Filters ─────────────────────────────────────────────────────────────────

test('dates serialize to Knack MM/DD/YYYY, never ISO', () => {
  assert.equal(toKnackDate('2026-01-15'), '01/15/2026');
  assert.equal(toKnackDate('2026-01-15T09:30:00Z'), '01/15/2026');
  assert.equal(toKnackDate(new Date(2026, 0, 5)), '01/05/2026');
  // Already in Knack format — left alone.
  assert.equal(toKnackDate('01/15/2026'), '01/15/2026');
});

test('filter serialization applies date normalization to values', () => {
  const json = serializeFilters([where.after('field_9', '2026-01-15')]);
  assert.equal(
    json,
    JSON.stringify({
      match: 'and',
      rules: [{ field: 'field_9', operator: 'is after', value: '01/15/2026' }],
    }),
  );
});

test('valueless operators omit value entirely', () => {
  const json = serializeFilters([where.blank('field_3')]);
  assert.equal(json, JSON.stringify({ match: 'and', rules: [{ field: 'field_3', operator: 'is blank' }] }));
});

test('empty filters serialize to null rather than an empty group', () => {
  assert.equal(serializeFilters([]), null);
  assert.equal(serializeFilters(undefined), null);
});

// ── Normalizers ─────────────────────────────────────────────────────────────

test('connection values normalize from every shape Knack sends', () => {
  assert.deepEqual(valueToStrings([{ id: '1', identifier: 'Acme' }]), ['Acme']);
  assert.deepEqual(valueToStrings('Acme'), ['Acme']);
  assert.deepEqual(valueToStrings(null), []);
  assert.deepEqual(valueToStrings(''), []);
  assert.deepEqual(connectionIds([{ id: '1', identifier: 'Acme' }]), ['1']);
  // A bare string carries no id — must not invent one.
  assert.deepEqual(connectionIds('Acme'), []);
  assert.equal(matchesAny([{ id: '1', identifier: 'A List' }], ['A List', 'B List']), true);
  assert.equal(matchesAny(null, ['A List']), false);
});

test('equation and currency values coerce to numbers', () => {
  assert.equal(toNumber(12), 12);
  assert.equal(toNumber('12'), 12);
  assert.equal(toNumber('$1,234.50'), 1234.5);
  assert.equal(toNumber('-42'), -42);
  assert.equal(toNumber(''), 0);
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber('n/a', -1), -1);
});

test('date/time raw shapes parse, including ranges', () => {
  assert.equal(toDate({ date: '01/15/2026' })?.getFullYear(), 2026);
  assert.equal(toDate({ iso_timestamp: '2026-01-15T09:30:00Z' })?.getUTCHours(), 9);
  assert.equal(toDate(null), null);
  const end = toDateRangeEnd({ date: '01/15/2026', to: { date: '01/20/2026' } });
  assert.equal(end?.getDate(), 20);
  assert.equal(toDateRangeEnd({ date: '01/15/2026' }), null);
});

test('rawField prefers _raw and falls back to the plain key', () => {
  const record = { field_1: '<span>Acme</span>', field_1_raw: [{ id: '1', identifier: 'Acme' }], field_2: 'plain' };
  assert.deepEqual(rawField(record, 'field_1'), [{ id: '1', identifier: 'Acme' }]);
  assert.equal(rawField(record, 'field_2'), 'plain');
});

// ── Identifiers ─────────────────────────────────────────────────────────────

test('identifiers are derived safely from Knack field names', () => {
  assert.equal(toCamelCase('First Name'), 'firstName');
  assert.equal(toCamelCase('Work Order #'), 'workOrder');
  assert.equal(toCamelCase('2nd Contact'), '_2ndContact');
  // "id" would shadow the record id on the generated interface.
  assert.equal(toCamelCase('ID'), 'id_');
  assert.equal(toPascalCase('work orders'), 'WorkOrders');
  assert.equal(singularize('Companies'), 'Company');
  assert.equal(singularize('Addresses'), 'Address');
  assert.equal(singularize('Status'), 'Status');
});

test('duplicate field names get suffixed instead of silently colliding', () => {
  const taken = new Set<string>();
  assert.equal(uniquify('status', taken), 'status');
  assert.equal(uniquify('status', taken), 'status2');
  assert.equal(uniquify('status', taken), 'status3');
});

// ── Codegen ─────────────────────────────────────────────────────────────────

const schema: KnackAppSchema = {
  id: 'app1',
  name: 'Test App',
  objects: [
    {
      key: 'object_3',
      name: 'Contacts',
      fields: [
        { key: 'field_12', name: 'First Name', type: 'short_text', required: true },
        { key: 'field_15', name: 'Email', type: 'email' },
        { key: 'field_31', name: 'Company', type: 'connection' },
        {
          key: 'field_18',
          name: 'Status',
          type: 'multiple_choice',
          required: true,
          format: { options: ['Active', 'Inactive'] },
        },
      ],
    },
  ],
};

const views: HarvestedViews = {
  scene_9: {
    slug: 'api-manager',
    views: [
      { key: 'view_44', type: 'table', object: 'object_3' },
      { key: 'view_45', type: 'form', object: 'object_3', action: 'create' },
      { key: 'view_46', type: 'form', object: 'object_3', action: 'update' },
    ],
  },
};

const config: KnackAppConfig = {
  appId: 'app1',
  apiPages: ['api-manager'],
  entities: {
    contacts: { object: 'Contacts', views: ['list', 'create', 'update'] },
  },
};

test('codegen emits friendly names, view refs and choice unions', () => {
  const result = generate(schema, views, config);
  assert.equal(result.missing.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.match(result.code, /contacts: 'object_3'/);
  assert.match(result.code, /firstName: 'field_12'/);
  assert.match(result.code, /list: \{ scene: 'scene_9', view: 'view_44' \}/);
  assert.match(result.code, /create: \{ scene: 'scene_9', view: 'view_45' \}/);
  assert.match(result.code, /update: \{ scene: 'scene_9', view: 'view_46' \}/);
  // Multiple choice becomes a literal union, so a typo is a compile error.
  assert.match(result.code, /status: "Active" \| "Inactive";/);
  // Optional fields are marked optional; required ones are not.
  assert.match(result.code, /firstName: string;/);
  assert.match(result.code, /email\?: KnackEmail \| null;/);
  assert.match(result.code, /company\?: KnackConnection\[\];/);
  assert.equal(result.stats.views, 3);
});

test('a missing view is reported with an actionable hint, not silently skipped', () => {
  const partial: HarvestedViews = {
    scene_9: { slug: 'api-manager', views: [{ key: 'view_44', type: 'table', object: 'object_3' }] },
  };
  const result = generate(schema, partial, config);
  assert.equal(result.missing.length, 2);
  const roles = result.missing.map((m) => m.role).sort();
  assert.deepEqual(roles, ['create', 'update']);
  assert.match(result.missing[0]!.hint, /Form view for "Contacts"/);
});

test('an entity naming a nonexistent object warns rather than emitting a broken map', () => {
  const bad: KnackAppConfig = { ...config, entities: { ghosts: { object: 'Ghosts', views: ['list'] } } };
  const result = generate(schema, views, bad);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /does not exist/);
  assert.doesNotMatch(result.code, /ghosts:/);
});

test('two indistinguishable form views resolve distinctly and warn', () => {
  const ambiguous: HarvestedViews = {
    scene_9: {
      slug: 'api-manager',
      views: [
        { key: 'view_44', type: 'table', object: 'object_3' },
        { key: 'view_45', type: 'form', object: 'object_3' },
        { key: 'view_46', type: 'form', object: 'object_3' },
      ],
    },
  };
  const result = generate(schema, ambiguous, config);
  assert.equal(result.missing.length, 0);
  // Must not assign the same view to both create and update.
  assert.match(result.code, /create: \{ scene: 'scene_9', view: 'view_45' \}/);
  assert.match(result.code, /update: \{ scene: 'scene_9', view: 'view_46' \}/);
  assert.ok(result.warnings.some((w) => /resolved to view_4\d by position/.test(w)));
});
