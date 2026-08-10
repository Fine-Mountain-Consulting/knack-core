/**
 * Programmatic access to the codegen, for tests and for anything that wants to
 * generate a schema without shelling out to the CLI.
 */
export { defineKnackConfig } from './config.js';
export type { KnackAppConfig, EntityManifestEntry, ViewRole } from './config.js';

export { generate } from './generate.js';
export type {
  FieldGap,
  GenerateResult,
  MissingView,
  ResolvedView,
  ScopingFinding,
} from './generate.js';

export { scenesToViews, viewFieldKeys, countViews } from './scenes.js';

export {
  planCrawl,
  crawlTargets,
  recordFieldKeys,
  objectCoverage,
  uncoveredProfiles,
  LISTABLE_TYPES,
  DETAIL_TYPES,
} from './crawler.js';
export type {
  AccountCrawl,
  CrawlAttempt,
  CrawlOptions,
  CrawlPlan,
  CrawlStatus,
  CrawlTarget,
  ObjectCoverage,
  SkippedView,
} from './crawler.js';

export { buildReport, renderMarkdown } from './crawlReport.js';
export type { CrawlReport } from './crawlReport.js';

export { toCamelCase, toPascalCase, singularize, uniquify, quoteKey } from './identifiers.js';
