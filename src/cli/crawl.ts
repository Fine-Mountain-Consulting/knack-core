#!/usr/bin/env -S node --experimental-strip-types
/**
 * `knack-crawl` — read a Knack app as its own users, and report what came back.
 *
 * Needs only the app id (already in knack.config.ts) and one login per role.
 * No REST API key, no Builder access, no views created for our benefit. See
 * `crawler.ts` for why that combination is the whole point.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { KnackAuth } from '../auth.js';
import { fetchAppSchema } from '../schema.js';
import { KnackViewClient } from '../viewClient.js';
import { crawlTargets, planCrawl, type AccountCrawl } from './crawler.js';
import { buildReport, renderMarkdown } from './crawlReport.js';
import { loadConfig } from './loadConfig.js';
import { c, fail } from './term.js';

interface CrawlAccountConfig {
  label?: string;
  email: string;
  password: string;
}

interface CredentialsFile {
  accounts: CrawlAccountConfig[];
}

const DEFAULT_CREDENTIALS = '.knack-crawl.json';
const DEFAULT_OUT = '.knack-crawl';

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const has = (name: string): boolean => process.argv.includes(`--${name}`);

const HELP = `
${c.bold('knack-crawl')} — read a Knack app as its own users

  ${c.dim('Reads every table, list, search and details view the supplied accounts can')}
  ${c.dim('reach, and reports which roles saw what. GET requests only.')}

${c.bold('Usage')}
  knack-crawl [options]

${c.bold('Options')}
  --credentials <file>   Accounts to sign in as. Default ${DEFAULT_CREDENTIALS}
  --out <dir>            Where to write the report. Default ${DEFAULT_OUT}
  --rows <n>             Records sampled per view. Default 3
  --values               Write real record values into the report. Off by default.
  --rps <n>              Requests per second. Default 8 (Knack's ceiling is ~10)
  --help

${c.bold('Credentials file')}
  {
    "accounts": [
      { "label": "user",  "email": "…", "password": "…" },
      { "label": "admin", "email": "…", "password": "…" }
    ]
  }

  ${c.yellow('Add it to .gitignore.')} One login per role profile, not per person —
  the crawl reports which profiles it covered and which it did not.
`;

const readCredentials = async (path: string): Promise<CrawlAccountConfig[]> => {
  if (!existsSync(path)) {
    fail(
      `No credentials file at ${path}.\n  ` +
        c.dim('Run `knack-crawl --help` for the format, and add the file to .gitignore.'),
    );
  }

  let parsed: CredentialsFile;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as CredentialsFile;
  } catch (error) {
    return fail(`${path} is not valid JSON.\n  ${String(error)}`);
  }

  const accounts = parsed?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    fail(`${path} must contain a non-empty "accounts" array.`);
  }
  for (const [i, account] of accounts!.entries()) {
    if (!account?.email || !account?.password) {
      fail(`Account ${i + 1} in ${path} is missing an email or a password.`);
    }
  }
  return accounts!;
};

/**
 * Shout if the credentials file is not ignored by git.
 *
 * A crude line match rather than full gitignore semantics — it only has to
 * catch the case that matters, which is nobody having thought about it.
 */
const warnIfTracked = async (cwd: string, credentialsPath: string): Promise<void> => {
  const gitignore = resolve(cwd, '.gitignore');
  const name = credentialsPath.replace(`${cwd}/`, '');

  const ignored = existsSync(gitignore)
    ? (await readFile(gitignore, 'utf8'))
        .split('\n')
        .map((line) => line.trim())
        .some((line) => line && !line.startsWith('#') && name.includes(line.replace(/^\/|\/$/g, '')))
    : false;

  if (!ignored) {
    console.log(
      `${c.yellow('!')} ${c.bold(name)} does not appear in .gitignore.\n  ` +
        c.dim('It holds live client passwords. Add it before you commit anything.'),
    );
  }
};

const main = async (): Promise<void> => {
  if (has('help')) {
    console.log(HELP);
    return;
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const credentialsPath = resolve(cwd, flag('credentials') ?? DEFAULT_CREDENTIALS);
  const outDir = resolve(cwd, flag('out') ?? DEFAULT_OUT);
  const rows = Number(flag('rows') ?? 3);
  const rps = Number(flag('rps') ?? 8);
  const includeValues = has('values');

  await warnIfTracked(cwd, credentialsPath);
  const accountConfigs = await readCredentials(credentialsPath);

  console.log(c.dim(`Fetching schema for app ${config.appId}…`));
  const schema = await fetchAppSchema(config.appId).catch((error: unknown) =>
    fail(error instanceof Error ? error.message : String(error)),
  );

  const plan = planCrawl(schema.scenes);
  const perAccount = plan.targets.length + plan.details.length;

  if (perAccount === 0) {
    fail('This app has no readable views. Nothing to crawl.');
  }

  console.log(
    `${c.dim('Crawling')} ${perAccount} views × ${accountConfigs.length} accounts ` +
      c.dim(`(~${Math.ceil((perAccount * accountConfigs.length) / rps)}s at ${rps} rps)`),
  );

  if (includeValues) {
    console.log(
      `${c.yellow('!')} ${c.bold('--values')} writes real client records to disk. ` +
        c.dim('Delete the report when you are done with it.'),
    );
  }

  const accounts: AccountCrawl[] = [];

  for (const account of accountConfigs) {
    const label = account.label ?? account.email;
    const auth = new KnackAuth({ appId: config.appId, apiHost: config.apiHost });

    let user;
    try {
      user = await auth.login(account.email, account.password);
    } catch (error) {
      // Never echo the password, and never abort the run — a bad login for one
      // role is itself a finding worth reporting alongside the others.
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${c.red('✖')} ${label}: ${message}`);
      accounts.push({
        label,
        email: account.email,
        userId: '',
        profileKeys: [],
        attempts: [],
        error: message,
      });
      continue;
    }

    console.log(
      `${c.green('✔')} ${c.bold(label)} signed in ` +
        c.dim(`(${user.profileKeys.join(', ') || 'no profile keys'})`),
    );

    const client = new KnackViewClient({
      appId: config.appId,
      apiHost: config.apiHost,
      rps,
      getToken: () => user.token,
    });

    const attempts = await crawlTargets(client, plan, {
      rows,
      includeValues,
      onProgress: (target, index, total) => {
        process.stdout.write(
          `\r  ${c.dim(`${index + 1}/${total}`)} ${target.view} ${' '.repeat(20)}`,
        );
      },
    });
    process.stdout.write('\r' + ' '.repeat(60) + '\r');

    accounts.push({
      label,
      email: account.email,
      userId: user.id,
      profileKeys: user.profileKeys,
      attempts,
    });
  }

  const report = buildReport(schema, plan, accounts, new Date().toISOString().slice(0, 16));

  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'report.md'), renderMarkdown(report), 'utf8');
  await writeFile(resolve(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const observed = report.coverage.reduce((n, o) => n + o.observed, 0);
  const total = report.coverage.reduce((n, o) => n + o.totalFields, 0);

  console.log(
    `\n${c.green('✔')} ${c.cyan(`${flag('out') ?? DEFAULT_OUT}/report.md`)} — ` +
      `${observed}/${total} fields observed (${Math.round((observed / total) * 100)}%) ` +
      `across ${accounts.filter((a) => !a.error).length} account(s).`,
  );

  if (report.uncovered.length > 0) {
    console.log(
      `${c.yellow('!')} No login supplied for: ` +
        report.uncovered.map((r) => `${r.name} (${r.profileKey})`).join(', ') +
        `\n  ${c.dim('Those roles are unrepresented in the report.')}`,
    );
  }
};

main().catch((error: unknown) => {
  console.error(`\n${c.red('✖')} ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
