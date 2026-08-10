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

export { toCamelCase, toPascalCase, singularize, uniquify, quoteKey } from './identifiers.js';
