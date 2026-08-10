/**
 * Programmatic access to the codegen, for tests and for anything that wants to
 * generate a schema without shelling out to the CLI.
 */
export { defineKnackConfig } from './config.js';
export type { KnackAppConfig, EntityManifestEntry, ViewRole } from './config.js';

export { generate } from './generate.js';
export type { GenerateResult, MissingView, ResolvedView } from './generate.js';

export { toCamelCase, toPascalCase, singularize, uniquify, quoteKey } from './identifiers.js';
