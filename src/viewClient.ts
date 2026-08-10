import { KnackError } from './errors.js';
import { serializeFilters } from './filters.js';
import { buildQuery, request, type HttpContext } from './http.js';
import type {
  KnackFile,
  KnackListOptions,
  KnackListResponse,
  KnackRawRecord,
  KnackViewRef,
} from './types.js';

export const DEFAULT_API_HOST = 'https://api.knack.com/v1';
/** GovCloud / HIPAA-dedicated tenants. See §4.1 of the blueprint. */
export const GOVCLOUD_API_HOST = 'https://usgc-api.knack.com/v1';

export interface KnackViewClientConfig {
  appId: string;
  /**
   * Override for GovCloud/HIPAA tenants. Getting this wrong is quiet and
   * expensive: the commercial host accepts writes for a dedicated tenant and
   * returns 200 without persisting them.
   */
  apiHost?: string;
  /** Requests per second. Defaults to 8 (Knack's limit is ~10). */
  rps?: number;
  /** Supplies the current user token. A function so the client sees rotations. */
  getToken?: () => string | null;
  onAuthError?: (error: KnackError) => void;
}

/**
 * View-based Knack client. Safe to run in a browser: it never carries a real
 * REST API key, and Knack enforces the logged-in user's role and record rules
 * on every request.
 */
export class KnackViewClient {
  readonly appId: string;
  readonly apiHost: string;
  private readonly ctx: HttpContext;
  private readonly getToken: () => string | null;

  constructor(config: KnackViewClientConfig) {
    this.appId = config.appId.trim();
    this.apiHost = (config.apiHost ?? DEFAULT_API_HOST).replace(/\/+$/, '');
    this.getToken = config.getToken ?? (() => null);
    this.ctx = {
      appId: this.appId,
      rps: config.rps,
      onAuthError: config.onAuthError,
    };
  }

  /**
   * `X-Knack-REST-API-Key` is the literal string 'knack' for view-based
   * requests. This is not a placeholder — a real key here would be a
   * full-database credential shipped to the browser.
   */
  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Knack-Application-Id': this.appId,
      'X-Knack-REST-API-Key': 'knack',
      ...extra,
    };
    const token = this.getToken();
    if (token) headers['Authorization'] = token;
    return headers;
  }

  private recordsUrl(view: KnackViewRef, recordId?: string): string {
    const base = `${this.apiHost}/pages/${view.scene}/views/${view.view}/records`;
    return recordId ? `${base}/${recordId}` : base;
  }

  async list<T = KnackRawRecord>(
    view: KnackViewRef,
    options: KnackListOptions = {},
  ): Promise<KnackListResponse<T>> {
    const query = buildQuery({
      page: options.page ?? 1,
      rows_per_page: Math.min(options.rowsPerPage ?? 25, 1000),
      sort_field: options.sortField,
      sort_order: options.sortOrder,
      filters: serializeFilters(options.filters),
    });

    const data = await request<{
      records?: T[];
      total_pages?: number;
      current_page?: number | string;
      total_records?: number;
    }>(this.recordsUrl(view) + query, this.ctx, {
      headers: this.headers(),
      signal: options.signal,
    });

    return {
      records: data.records ?? [],
      totalPages: data.total_pages ?? 1,
      currentPage: Number(data.current_page ?? options.page ?? 1),
      totalRecords: data.total_records ?? data.records?.length ?? 0,
    };
  }

  async get<T = KnackRawRecord>(
    view: KnackViewRef,
    recordId: string,
    signal?: AbortSignal,
  ): Promise<T> {
    return request<T>(this.recordsUrl(view, recordId), this.ctx, {
      headers: this.headers(),
      signal,
    });
  }

  async create<T = KnackRawRecord>(
    view: KnackViewRef,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    return request<T>(this.recordsUrl(view), this.ctx, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: data,
      signal,
    });
  }

  async update<T = KnackRawRecord>(
    view: KnackViewRef,
    recordId: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    return request<T>(this.recordsUrl(view, recordId), this.ctx, {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: data,
      signal,
    });
  }

  async remove(view: KnackViewRef, recordId: string, signal?: AbortSignal): Promise<void> {
    await request<unknown>(this.recordsUrl(view, recordId), this.ctx, {
      method: 'DELETE',
      headers: this.headers(),
      signal,
    });
  }

  /**
   * Walk every page of a view.
   *
   * Deliberately capped: an unbounded loop against a large object will burn
   * the user's entire rate-limit budget and hang the tab. If you need more
   * than this, you need the server-side proxy (blueprint §4.7), not a bigger
   * number here.
   */
  async listAll<T = KnackRawRecord>(
    view: KnackViewRef,
    options: Omit<KnackListOptions, 'page' | 'rowsPerPage'> & { maxRecords?: number } = {},
  ): Promise<T[]> {
    const maxRecords = options.maxRecords ?? 5000;
    const all: T[] = [];
    let page = 1;

    for (;;) {
      const result = await this.list<T>(view, { ...options, page, rowsPerPage: 1000 });
      all.push(...result.records);
      if (all.length >= maxRecords) return all.slice(0, maxRecords);
      if (page >= result.totalPages || result.records.length === 0) return all;
      page++;
    }
  }

  /**
   * Upload a file and get back the asset id to write into a file field.
   * Note this is an application-level endpoint, not a view-based one, but it
   * accepts the same 'knack' API key value alongside a user token.
   */
  async uploadFile(file: File, signal?: AbortSignal): Promise<KnackFile> {
    const form = new FormData();
    form.append('files', file, file.name);

    // Content-Type is deliberately omitted: the browser must set the
    // multipart boundary itself.
    const result = await request<KnackFile>(
      `${this.apiHost}/applications/${this.appId}/assets/file/upload`,
      this.ctx,
      { method: 'POST', headers: this.headers(), rawBody: form, signal },
    );

    if (!result?.id) {
      throw new KnackError('Knack file upload returned no asset id', {
        status: 0,
        body: result,
        url: 'assets/file/upload',
      });
    }
    return result;
  }
}
