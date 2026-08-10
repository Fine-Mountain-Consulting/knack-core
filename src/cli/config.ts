/**
 * The shape of `knack.config.ts` in a consuming app.
 *
 * The entity manifest is the contract: it declares which Knack objects the UI
 * uses and which views each one needs. `knack-sync` diffs it against the live
 * app and the harvested views, so a missing view is a build-time error with an
 * exact fix rather than a runtime `undefined`.
 */

export type ViewRole = 'list' | 'create' | 'update' | 'delete';

export interface EntityManifestEntry {
  /** The Knack object's name, exactly as it appears in the Builder. */
  object: string;
  /**
   * Which views this entity needs. `list` covers read-one and delete unless
   * a separate `delete` view is declared.
   */
  views: ViewRole[];
  /** Restrict view resolution to specific API pages, by slug or key. */
  pages?: string[];
  /**
   * Field names — as they appear in the Builder — that the UI reads or writes
   * for this entity. `knack-sync` checks each resolved view actually exposes
   * them, because a field left off a view is simply absent from the API
   * response. Omit to skip the check.
   */
  fields?: string[];
}

export interface KnackAppConfig {
  appId: string;
  apiHost?: string;
  /** Page slugs or keys holding the headless API views. */
  apiPages: string[];
  /** Logical entity name -> manifest. Keys become the codegen identifiers. */
  entities: Record<string, EntityManifestEntry>;
  /** Knack profile key -> app role name. */
  roles?: Record<string, string>;
  /** Where to write the generated schema. Defaults to src/knack/schema.generated.ts */
  outFile?: string;
  /**
   * Offline fallback for scene/view keys. Defaults to knack.views.json.
   *
   * Not normally needed: views come from the same unauthenticated response as
   * the objects. `knack-harvest` writes this file so a build can run without
   * network access, and it is ignored whenever the live app returns scenes.
   */
  viewsFile?: string;
  /**
   * Allow API views whose source is not scoped to the logged-in user and
   * carries no filter criteria. Such a view returns every record of its object
   * to anyone whose role can reach the page — Knack roles gate the page, not
   * the rows. Set only for genuinely role-wide reference data, and say why.
   */
  allowUnscopedViews?: string[];
}

export const defineKnackConfig = (config: KnackAppConfig): KnackAppConfig => config;
