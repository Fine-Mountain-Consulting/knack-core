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
import { generate, scenesToViews, viewFieldKeys } from '../dist/cli/index.js';
import { objectCoverage, planCrawl, recordFieldKeys, uncoveredProfiles } from '../dist/cli/index.js';
import type { KnackAppSchema, HarvestedViews, KnackSceneDef } from '../dist/index.js';
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
  scenes: [],
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

// ── Scenes → views ──────────────────────────────────────────────────────────
//
// Shapes here mirror a live app definition, not an idealized one: a table's
// columns are flat with `field.key`, a form nests groups → columns → inputs,
// and Knack writes an empty `criteria.rules` on every view whether or not a
// filter is set.

const scenes: KnackSceneDef[] = [
  {
    key: 'scene_9',
    name: 'API — Manager',
    slug: 'api-manager',
    authenticated: true,
    views: [
      {
        key: 'view_44',
        name: 'Contacts',
        type: 'table',
        source: {
          object: 'object_3',
          authenticated_user: true,
          connection_key: 'field_31',
          criteria: { match: 'any', rules: [], groups: [] },
        },
        columns: [
          { type: 'field', field: { key: 'field_12' }, header: 'First Name' },
          { type: 'field', field: { key: 'field_15' }, header: 'Email' },
        ],
      },
      {
        key: 'view_45',
        name: 'Add Contact',
        type: 'form',
        action: 'insert',
        source: { object: 'object_3' },
        inputs: [],
        groups: [
          {
            columns: [
              {
                inputs: [
                  { field: { key: 'field_12' }, label: 'First Name' },
                  { field: { key: 'field_31' }, label: 'Company' },
                ],
              },
            ],
          },
        ],
        // Sets Status on submit. A rule reference is not an exposed field.
        rules: { records: [{ values: [{ field: 'field_18', value: 'Active' }] }] },
      },
      {
        key: 'view_60',
        name: 'All Contacts',
        type: 'table',
        source: { object: 'object_3', criteria: { match: 'any', rules: [], groups: [] } },
        columns: [{ type: 'field', field: { key: 'field_12' } }],
      },
    ],
  },
];

test('scenes normalize into the view map, with exposed fields and scoping', () => {
  const derived = scenesToViews(scenes);
  const page = derived.scene_9!;

  assert.equal(page.slug, 'api-manager');
  assert.equal(page.authenticated, true);
  assert.equal(page.views.length, 3);

  const table = page.views.find((v) => v.key === 'view_44')!;
  assert.equal(table.object, 'object_3');
  assert.deepEqual(table.fields, ['field_12', 'field_15']);
  assert.equal(table.authenticatedUser, true);

  // Nested groups → columns → inputs are reached.
  const form = page.views.find((v) => v.key === 'view_45')!;
  assert.deepEqual(form.fields, ['field_12', 'field_31']);
  assert.equal(form.action, 'insert');
});

test('a field referenced only by a submit rule is not an exposed field', () => {
  // field_18 is set by a record rule on view_45 but is not an input, so it does
  // not come back from the API. Counting it would mask the exact bug the
  // field-gap check exists to catch.
  const form = scenes[0]!.views!.find((v) => v.key === 'view_45')!;
  assert.deepEqual(viewFieldKeys(form), ['field_12', 'field_31']);
});

test('an empty criteria.rules array does not count as record scoping', () => {
  const derived = scenesToViews(scenes);
  const unscoped = derived.scene_9!.views.find((v) => v.key === 'view_60')!;
  assert.equal(unscoped.authenticatedUser, undefined);
  assert.equal(unscoped.hasCriteria, undefined);
});

// ── Field-gap and scoping checks ────────────────────────────────────────────

const sceneSchema: KnackAppSchema = { ...schema, scenes };

test('a manifest field missing from the resolved view is a build error', () => {
  const derived = scenesToViews(scenes);
  const result = generate(sceneSchema, derived, {
    ...config,
    entities: {
      contacts: {
        object: 'Contacts',
        views: ['list'],
        // Company is on the form, not on the table.
        fields: ['First Name', 'Company'],
      },
    },
  });

  assert.equal(result.fieldGaps.length, 1);
  assert.equal(result.fieldGaps[0]!.view, 'view_44');
  assert.deepEqual(result.fieldGaps[0]!.missing, ['Company']);
});

test('declared fields present on the view produce no gap', () => {
  const result = generate(sceneSchema, scenesToViews(scenes), {
    ...config,
    entities: {
      contacts: { object: 'Contacts', views: ['list'], fields: ['First Name', 'Email'] },
    },
  });
  assert.equal(result.fieldGaps.length, 0);
  assert.equal(result.scoping.length, 0);
});

test('a misspelled manifest field warns instead of failing silently', () => {
  const result = generate(sceneSchema, scenesToViews(scenes), {
    ...config,
    entities: { contacts: { object: 'Contacts', views: ['list'], fields: ['Frist Name'] } },
  });
  assert.ok(result.warnings.some((w) => /does not exist on "Contacts"/.test(w)));
  assert.equal(result.fieldGaps.length, 0);
});

test('an unscoped list view is reported — roles gate the page, not the rows', () => {
  // Force resolution onto view_60, which has neither authenticated_user nor
  // filter criteria, by removing the scoped table from the scene.
  const onlyUnscoped = scenesToViews([
    { ...scenes[0]!, views: scenes[0]!.views!.filter((v) => v.key !== 'view_44') },
  ]);
  const result = generate(sceneSchema, onlyUnscoped, {
    ...config,
    entities: { contacts: { object: 'Contacts', views: ['list'] } },
  });

  assert.equal(result.scoping.length, 1);
  assert.equal(result.scoping[0]!.view, 'view_60');
  assert.equal(result.scoping[0]!.objectName, 'Contacts');
});

test('allowUnscopedViews suppresses the finding for reference data', () => {
  const onlyUnscoped = scenesToViews([
    { ...scenes[0]!, views: scenes[0]!.views!.filter((v) => v.key !== 'view_44') },
  ]);
  const result = generate(sceneSchema, onlyUnscoped, {
    ...config,
    allowUnscopedViews: ['view_60'],
    entities: { contacts: { object: 'Contacts', views: ['list'] } },
  });
  assert.equal(result.scoping.length, 0);
});

test('views from the legacy console snippet are not failed for scoping', () => {
  // The snippet cannot report source scoping, so its output carries neither
  // flag. Treating that silence as "unscoped" would fail every pre-existing
  // project on a question its data cannot answer.
  const result = generate(schema, views, config);
  assert.equal(result.scoping.length, 0);
  assert.equal(result.fieldGaps.length, 0);
});

// ── Crawl planning and coverage ─────────────────────────────────────────────

const crawlScenes: KnackSceneDef[] = [
  {
    key: 'scene_9',
    slug: 'contacts',
    authenticated: true,
    views: [
      {
        key: 'view_44',
        type: 'table',
        source: { object: 'object_3', authenticated_user: true, connection_key: 'field_31' },
        columns: [{ field: { key: 'field_12' } }, { field: { key: 'field_15' } }],
      },
      {
        key: 'view_70',
        type: 'details',
        source: { object: 'object_3' },
        columns: [{ field: { key: 'field_12' } }, { field: { key: 'field_18' } }],
      },
      { key: 'view_45', type: 'form', action: 'insert', source: { object: 'object_3' }, inputs: [] },
      { key: 'view_99', type: 'menu' },
    ],
  },
];

test('crawl planning splits listable, detail and skipped views', () => {
  const plan = planCrawl(crawlScenes);

  assert.deepEqual(plan.targets.map((t) => t.view), ['view_44']);
  assert.deepEqual(plan.details.map((t) => t.view), ['view_70']);

  // A form is never crawled — a write against a live app fires its record
  // rules — but it stays in the plan, because it is still API surface.
  assert.deepEqual(plan.writeViews.map((t) => t.view), ['view_45']);

  // A sourceless view is still accounted for, never silently dropped.
  const menu = plan.skipped.find((s) => s.view === 'view_99')!;
  assert.equal(menu.reason, 'no-source-object');

  assert.equal(plan.targets[0]!.scoped, true);
  assert.deepEqual(plan.targets[0]!.declaredFields, ['field_12', 'field_15']);
});

test('record field keys collapse _raw duplicates and ignore non-field keys', () => {
  assert.deepEqual(
    recordFieldKeys([
      { id: 'abc', field_12: 'Ada', field_12_raw: 'Ada', field_15: 'a@b.c' },
      { id: 'def', field_31: [{ id: '1', identifier: 'Acme' }] },
    ]),
    ['field_12', 'field_15', 'field_31'],
  );
  assert.deepEqual(recordFieldKeys([]), []);
});

test('coverage separates what a view declares from what a request returned', () => {
  const plan = planCrawl(crawlScenes);
  const accounts = [
    {
      label: 'user',
      email: 'u@example.com',
      userId: 'u1',
      profileKeys: ['profile_19'],
      attempts: [
        {
          scene: 'scene_9',
          view: 'view_44',
          viewType: 'table',
          object: 'object_3',
          status: 'ok' as const,
          totalRecords: 2,
          sampled: 2,
          // field_15 is configured on the view but never came back.
          fields: ['field_12'],
          absent: ['field_15'],
          undeclared: [],
        },
      ],
    },
  ];

  const [contacts] = objectCoverage({ ...schema, scenes: crawlScenes }, plan, accounts);

  assert.equal(contacts!.totalFields, 4);
  // Readable views (table + details) expose 12, 15, 18.
  assert.equal(contacts!.declaredRead, 3);
  // The add form contributes no inputs in this fixture, so all-views matches.
  assert.equal(contacts!.declaredAll, 3);
  assert.equal(contacts!.observed, 1);
  assert.ok(contacts!.unreached.includes('field_15'));
  assert.equal(contacts!.reachable, true);
});

test('roles with no supplied login are named rather than assumed empty', () => {
  const roleSchema: KnackAppSchema = {
    ...schema,
    objects: [
      ...schema.objects,
      { key: 'object_19', name: 'User', user: true, profile_key: 'profile_19', fields: [] },
      { key: 'object_20', name: 'Admin', user: true, profile_key: 'profile_20', fields: [] },
    ],
  };

  const uncovered = uncoveredProfiles(roleSchema, [
    { label: 'user', email: 'u@e.c', userId: 'u1', profileKeys: ['profile_19'], attempts: [] },
  ]);

  assert.deepEqual(uncovered, [{ profileKey: 'profile_20', name: 'Admin' }]);
});

test('a child-scene view scoped by its parent record is not reported as unscoped', () => {
  // Knack expresses parent scoping with neither authenticated_user nor
  // criteria — only the scene's `object` plus a connection_key reveal it.
  // Counting these as unscoped would fail correct apps and, worse, push real
  // leaks into allowUnscopedViews alongside the noise.
  const childScene: KnackSceneDef[] = [
    {
      key: 'scene_8',
      slug: 'recipedetails',
      parent: 'myrecipes',
      object: 'object_1',
      authenticated: true,
      views: [
        {
          key: 'view_27',
          type: 'table',
          source: { object: 'object_2', connection_key: 'field_6', relationship_type: 'local' },
          columns: [{ field: { key: 'field_3' } }],
        },
      ],
    },
  ];

  const derived = scenesToViews(childScene);
  const view = derived.scene_8!.views[0]!;
  assert.equal(view.parentScoped, true);
  assert.equal(view.authenticatedUser, undefined);

  const plan = planCrawl(childScene);
  assert.equal(plan.targets[0]!.parentScoped, true);
  assert.equal(plan.targets[0]!.scoped, true);
});

test('a top-level view with a connection but no scene record is still unscoped', () => {
  // The connection_key alone means nothing — it is the scene's `object` that
  // supplies the record to scope against.
  const flat: KnackSceneDef[] = [
    {
      key: 'scene_2',
      slug: 'all-things',
      authenticated: true,
      views: [
        {
          key: 'view_90',
          type: 'table',
          source: { object: 'object_2', connection_key: 'field_6' },
          columns: [{ field: { key: 'field_3' } }],
        },
      ],
    },
  ];

  assert.equal(scenesToViews(flat).scene_2!.views[0]!.parentScoped, undefined);
  assert.equal(planCrawl(flat).targets[0]!.scoped, false);
});
