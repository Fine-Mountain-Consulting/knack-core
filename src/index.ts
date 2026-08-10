/**
 * @fmc/knack-core — browser-safe entry point.
 *
 * Everything exported here is view-based and carries no REST API key. The
 * object-based client, which does carry one, lives behind `@fmc/knack-core/server`
 * and must never be imported into browser code.
 */

export { KnackViewClient, DEFAULT_API_HOST, GOVCLOUD_API_HOST } from './viewClient.js';
export type { KnackViewClientConfig } from './viewClient.js';

export { KnackAuth, rolesFromProfileKeys } from './auth.js';
export type { KnackAuthConfig, KnackSession } from './auth.js';

export { KnackError } from './errors.js';

export { where, serializeFilters, toKnackDate } from './filters.js';

export {
  valueToStrings,
  matchesAny,
  connectionIds,
  firstConnection,
  toNumber,
  toBoolean,
  toDate,
  toDateRangeEnd,
  toText,
  toEmail,
  toLink,
  toPhone,
  toFiles,
  toAddress,
  mapRecord,
  mapRecords,
  rawField,
} from './normalize.js';

export { fetchAppSchema, LOADER_URL } from './schema.js';

export type {
  KnackAddress,
  KnackAppSchema,
  KnackConnection,
  KnackConnectionValue,
  KnackDate,
  KnackEmail,
  KnackFieldDef,
  KnackFile,
  KnackFilter,
  KnackFilterGroup,
  KnackLink,
  KnackListOptions,
  KnackListResponse,
  KnackName,
  KnackObjectDef,
  KnackOperator,
  KnackPhone,
  KnackRawRecord,
  KnackSceneDef,
  KnackUser,
  KnackViewColumn,
  KnackViewDef,
  KnackViewInput,
  KnackViewRef,
  KnackViewSource,
  HarvestedPage,
  HarvestedView,
  HarvestedViews,
} from './types.js';
