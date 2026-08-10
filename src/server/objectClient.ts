import { serializeFilters } from '../filters.js';
import { buildQuery, request, type HttpContext } from '../http.js';
import type {
  KnackListOptions,
  KnackListResponse,
  KnackRawRecord,
} from '../types.js';
import { DEFAULT_API_HOST } from '../viewClient.js';

export interface KnackObjectClientConfig {
  appId: string;
  /** A real Knack REST API key. From Secret Manager — never from source. */
  apiKey: string;
  apiHost?: string;
  rps?: number;
  /**
   * Optional user token. When set, Knack still applies that user's record
   * rules — worth using in a proxy so the caller can't reach past their own
   * permissions.
   */
  userToken?: string;
}

/**
 * Object-based client. Bypasses Knack's permission model — see the warning in
 * `./index.ts` before using it.
 */
export class KnackObjectClient {
  readonly appId: string;
  readonly apiHost: string;
  private readonly apiKey: string;
  private readonly userToken: string | undefined;
  private readonly ctx: HttpContext;

  constructor(config: KnackObjectClientConfig) {
    this.appId = config.appId.trim();
    this.apiKey = config.apiKey.trim();
    this.apiHost = (config.apiHost ?? DEFAULT_API_HOST).replace(/\/+$/, '');
    this.userToken = config.userToken?.trim();
    this.ctx = { appId: this.appId, rps: config.rps };
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Knack-Application-Id': this.appId,
      'X-Knack-REST-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
    if (this.userToken) headers['Authorization'] = this.userToken;
    return headers;
  }

  private url(objectKey: string, recordId?: string): string {
    const base = `${this.apiHost}/objects/${objectKey}/records`;
    return recordId ? `${base}/${recordId}` : base;
  }

  async list<T = KnackRawRecord>(
    objectKey: string,
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
    }>(this.url(objectKey) + query, this.ctx, { headers: this.headers(), signal: options.signal });

    return {
      records: data.records ?? [],
      totalPages: data.total_pages ?? 1,
      currentPage: Number(data.current_page ?? options.page ?? 1),
      totalRecords: data.total_records ?? 0,
    };
  }

  async get<T = KnackRawRecord>(objectKey: string, recordId: string): Promise<T> {
    return request<T>(this.url(objectKey, recordId), this.ctx, { headers: this.headers() });
  }

  async create<T = KnackRawRecord>(
    objectKey: string,
    data: Record<string, unknown>,
  ): Promise<T> {
    return request<T>(this.url(objectKey), this.ctx, {
      method: 'POST',
      headers: this.headers(),
      body: data,
    });
  }

  async update<T = KnackRawRecord>(
    objectKey: string,
    recordId: string,
    data: Record<string, unknown>,
  ): Promise<T> {
    return request<T>(this.url(objectKey, recordId), this.ctx, {
      method: 'PUT',
      headers: this.headers(),
      body: data,
    });
  }

  async remove(objectKey: string, recordId: string): Promise<void> {
    await request<unknown>(this.url(objectKey, recordId), this.ctx, {
      method: 'DELETE',
      headers: this.headers(),
    });
  }

  async count(objectKey: string, options: Pick<KnackListOptions, 'filters'> = {}): Promise<number> {
    const result = await this.list(objectKey, { ...options, rowsPerPage: 1, page: 1 });
    return result.totalRecords;
  }

  /** Walk every page. Server-side, so uncapped — but still rate-limited. */
  async listAll<T = KnackRawRecord>(
    objectKey: string,
    options: Omit<KnackListOptions, 'page' | 'rowsPerPage'> = {},
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    for (;;) {
      const result = await this.list<T>(objectKey, { ...options, page, rowsPerPage: 1000 });
      all.push(...result.records);
      if (page >= result.totalPages || result.records.length === 0) return all;
      page++;
    }
  }
}
