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
  /** Where harvested views live. Defaults to knack.views.json */
  viewsFile?: string;
}

export const defineKnackConfig = (config: KnackAppConfig): KnackAppConfig => config;
