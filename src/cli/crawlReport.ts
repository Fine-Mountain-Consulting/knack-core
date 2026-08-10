/**
 * Renders a crawl into something a human reads before quoting a migration.
 *
 * The report is deliberately opinionated about what leads: which roles saw
 * what, and where the app definition promised a field that no request ever
 * returned. Those two answers are the reason to run a crawl at all.
 */
import type { KnackAppSchema } from '../types.js';
import type { AccountCrawl, CrawlAttempt, CrawlPlan, ObjectCoverage } from './crawler.js';
import { objectCoverage, uncoveredProfiles } from './crawler.js';

export interface CrawlReport {
  appId: string;
  appName: string;
  generatedAt: string;
  accounts: AccountCrawl[];
  plan: CrawlPlan;
  coverage: ObjectCoverage[];
  uncovered: Array<{ profileKey: string; name: string }>;
}

export const buildReport = (
  schema: KnackAppSchema,
  plan: CrawlPlan,
  accounts: AccountCrawl[],
  generatedAt: string,
): CrawlReport => ({
  appId: schema.id,
  appName: schema.name,
  generatedAt,
  accounts,
  plan,
  coverage: objectCoverage(schema, plan, accounts),
  uncovered: uncoveredProfiles(schema, accounts),
});

const cell = (attempt: CrawlAttempt | undefined): string => {
  if (!attempt) return '·';
  switch (attempt.status) {
    case 'ok':
      return String(attempt.totalRecords ?? attempt.sampled);
    case 'empty':
      return '0';
    case 'forbidden':
      return '—';
    case 'not-found':
      return '404';
    default:
      return '!';
  }
};

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);

/** A view is worth flagging when every account failed to read it. */
const unreadable = (accounts: AccountCrawl[], view: string): boolean =>
  accounts.length > 0 &&
  accounts.every((a) => {
    const attempt = a.attempts.find((x) => x.view === view);
    return !attempt || attempt.status === 'forbidden' || attempt.status === 'error';
  });

export const renderMarkdown = (report: CrawlReport): string => {
  const { accounts, plan, coverage } = report;
  const out: string[] = [];
  const byView = new Map(
    [...plan.targets, ...plan.details].map((t) => [t.view, t] as const),
  );

  out.push(`# ${report.appName} — crawl report`);
  out.push('');
  out.push(
    `App \`${report.appId}\` · ${report.generatedAt} · ` +
      `${accounts.length} account${accounts.length === 1 ? '' : 's'} · ` +
      `${plan.targets.length} list views, ${plan.details.length} detail views`,
  );
  out.push('');
  out.push(
    'Read-only. Every request was a `GET` made as a real logged-in user, so ' +
      'Knack applied that user’s roles and record rules throughout.',
  );
  out.push('');

  // ── Accounts ──────────────────────────────────────────────────────────────
  out.push('## Accounts');
  out.push('');
  out.push('| Label | Profile keys | Views read | Empty | Forbidden | Errors |');
  out.push('|---|---|---:|---:|---:|---:|');
  for (const account of accounts) {
    const tally = (s: string) => account.attempts.filter((a) => a.status === s).length;
    out.push(
      `| ${account.label} | ${account.profileKeys.join(', ') || '—'} | ${tally('ok')} | ` +
        `${tally('empty')} | ${tally('forbidden')} | ${tally('error') + tally('not-found')} |`,
    );
  }
  out.push('');

  if (report.uncovered.length > 0) {
    out.push(
      `> **${report.uncovered.length} role${report.uncovered.length === 1 ? '' : 's'} not crawled.** ` +
        report.uncovered.map((r) => `${r.name} (\`${r.profileKey}\`)`).join(', ') +
        '. No supplied account holds these profiles, so nothing below reflects what they see. ' +
        'Either get a login for each, or confirm the role is unused.',
    );
    out.push('');
  }

  for (const account of accounts.filter((a) => a.error)) {
    out.push(`> **${account.label} could not sign in.** ${account.error}`);
    out.push('');
  }

  // ── Field coverage ────────────────────────────────────────────────────────
  out.push('## Field coverage by object');
  out.push('');
  out.push(
    'Three different questions, so three columns. **All views** is every field ' +
      'some existing view touches, forms included — what the app’s own views could ' +
      'carry, and the number to judge a migration against. **Readable** is the ' +
      'subset on views a crawl may call; it is always lower because forms are ' +
      'never crawled. **Observed** is what a request actually returned.',
  );
  out.push('');
  out.push('| Object | Fields | All views | Readable | Observed | Observed % |');
  out.push('|---|---:|---:|---:|---:|---:|');
  for (const o of [...coverage].sort((a, b) => b.declaredAll - a.declaredAll)) {
    out.push(
      `| ${o.name} \`${o.key}\` | ${o.totalFields} | ${o.declaredAll} | ${o.declaredRead} | ` +
        `${o.observed} | ${pct(o.observed, o.totalFields)} |`,
    );
  }
  const totals = coverage.reduce(
    (acc, o) => ({
      fields: acc.fields + o.totalFields,
      all: acc.all + o.declaredAll,
      read: acc.read + o.declaredRead,
      observed: acc.observed + o.observed,
    }),
    { fields: 0, all: 0, read: 0, observed: 0 },
  );
  out.push(
    `| **Total** | **${totals.fields}** | **${totals.all}** | **${totals.read}** | ` +
      `**${totals.observed}** | **${pct(totals.observed, totals.fields)}** |`,
  );
  out.push('');
  out.push(
    `Across the whole app: ${pct(totals.all, totals.fields)} of fields appear on some ` +
      `view, ${pct(totals.read, totals.fields)} on a readable one, ` +
      `${pct(totals.observed, totals.fields)} actually came back. Fields on no view ` +
      'at all are unreachable without either Builder access or a REST API key.',
  );
  out.push('');

  const unreachable = coverage.filter((o) => !o.reachable);
  if (unreachable.length > 0) {
    out.push(
      `**${unreachable.length} object${unreachable.length === 1 ? '' : 's'} returned nothing at all:** ` +
        unreachable.map((o) => `${o.name} (\`${o.key}\`)`).join(', ') +
        '. These are typically reference tables that only ever appear as connection ' +
        'dropdowns — a dropdown returns an identifier string, not a record, so their ' +
        'fields are unreachable through the existing views.',
    );
    out.push('');
  }

  // ── Role × view matrix ────────────────────────────────────────────────────
  out.push('## Role × view matrix');
  out.push('');
  out.push(
    'Cells are the record count Knack reported for that account. ' +
      '`0` means reachable but empty — no data, or a scope that excludes this user. ' +
      '`—` means Knack refused (401/403). `·` means not attempted.',
  );
  out.push('');
  out.push(`| View | Type | Object | Scoped | ${accounts.map((a) => a.label).join(' | ')} |`);
  out.push(`|---|---|---|---|${accounts.map(() => '---:').join('|')}|`);

  for (const target of [...plan.targets, ...plan.details]) {
    const cells = accounts.map((a) => cell(a.attempts.find((x) => x.view === target.view)));
    out.push(
      `| \`${target.view}\` ${target.viewName ?? ''} | ${target.viewType} | ` +
        `\`${target.object}\` | ${target.scoped ? 'yes' : '**no**'} | ${cells.join(' | ')} |`,
    );
  }
  out.push('');

  const blocked = [...byView.keys()].filter((v) => unreadable(accounts, v));
  if (blocked.length > 0) {
    out.push(
      `**${blocked.length} view${blocked.length === 1 ? '' : 's'} no account could read.** ` +
        'Either they belong to a role you have not supplied a login for, or they sit on ' +
        'a child page that needs a parent record in context.',
    );
    out.push('');
  }

  // ── Declared but never returned ───────────────────────────────────────────
  const gaps = accounts
    .flatMap((a) => a.attempts)
    .filter((a) => a.status === 'ok' && a.absent.length > 0);

  if (gaps.length > 0) {
    out.push('## Fields declared on a view but absent from its response');
    out.push('');
    out.push(
      'The view is configured to show these, yet no sampled record carried them. ' +
        'Usually an empty value that Knack omits rather than sends as null — which ' +
        'is exactly the difference that turns into an `undefined` in a component.',
    );
    out.push('');
    out.push('| View | Object | Absent |');
    out.push('|---|---|---|');
    const seen = new Set<string>();
    for (const gap of gaps) {
      if (seen.has(gap.view)) continue;
      seen.add(gap.view);
      out.push(`| \`${gap.view}\` | \`${gap.object}\` | ${gap.absent.join(', ')} |`);
    }
    out.push('');
  }

  // ── Skipped ───────────────────────────────────────────────────────────────
  const notListable = plan.skipped.filter((s) => s.reason === 'not-listable');
  if (notListable.length > 0) {
    const byType = new Map<string, number>();
    for (const s of notListable) byType.set(s.viewType, (byType.get(s.viewType) ?? 0) + 1);
    out.push('## Not crawled');
    out.push('');
    out.push(
      `${notListable.length} views have a source object but do not answer the collection ` +
        'endpoint, so they were not attempted: ' +
        [...byType].map(([t, n]) => `${n} × \`${t}\``).join(', ') +
        '. Forms are excluded on purpose — reading them is possible, but this tool ' +
        'never issues a write against a live app.',
    );
    out.push('');
  }

  return `${out.join('\n')}\n`;
};
