/**
 * @fmc/knack-core/server — object-based Knack client.
 *
 * ⚠ SERVER-SIDE ONLY. This client sends a real `X-Knack-REST-API-Key`, which
 * is a full-access credential for the client's entire Knack database: every
 * object, every record, all role and record-rule enforcement bypassed.
 *
 * Importing this into browser code is the single worst mistake available in
 * this architecture. Use it in Cloud Functions and Node scripts only, with the
 * key from Secret Manager. Browser code uses `@fmc/knack-core` (view-based).
 */

export { KnackObjectClient } from './objectClient.js';
export type { KnackObjectClientConfig } from './objectClient.js';
