import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { KnackError } from '../errors.js';
import { serializeFilters } from '../filters.js';
import type {
  KnackListOptions,
  KnackListResponse,
  KnackRawRecord,
  KnackViewRef,
} from '../types.js';
import { useKnack } from './KnackProvider.js';

/**
 * Query keys are derived from the view plus the serialized query, so two
 * components asking for the same page of the same filtered list share one
 * request — the main reason every Knack read goes through this layer.
 */
export const knackKeys = {
  view: (view: KnackViewRef) => ['knack', view.scene, view.view] as const,
  list: (view: KnackViewRef, options: KnackListOptions = {}) =>
    [
      ...knackKeys.view(view),
      'list',
      {
        page: options.page ?? 1,
        rowsPerPage: options.rowsPerPage ?? 25,
        sortField: options.sortField ?? null,
        sortOrder: options.sortOrder ?? null,
        filters: serializeFilters(options.filters),
      },
    ] as const,
  record: (view: KnackViewRef, id: string) => [...knackKeys.view(view), 'record', id] as const,
};

/** Retrying an auth or not-found error just delays the inevitable. */
const retryPolicy = (failureCount: number, error: unknown): boolean => {
  if (error instanceof KnackError && (error.isAuthError || error.isNotFound)) return false;
  return failureCount < 2;
};

export interface UseKnackListOptions extends KnackListOptions {
  enabled?: boolean;
  staleTimeMs?: number;
}

export const useKnackList = <T = KnackRawRecord>(
  view: KnackViewRef,
  options: UseKnackListOptions = {},
): UseQueryResult<KnackListResponse<T>, KnackError> => {
  const { client } = useKnack();
  const { enabled = true, staleTimeMs = 30_000, ...listOptions } = options;

  return useQuery<KnackListResponse<T>, KnackError, KnackListResponse<T>>({
    queryKey: knackKeys.list(view, listOptions),
    queryFn: ({ signal }) => client.list<T>(view, { ...listOptions, signal }),
    enabled,
    staleTime: staleTimeMs,
    retry: retryPolicy,
    placeholderData: (previous) => previous, // keeps the table steady while paging
  });
};

export const useKnackRecord = <T = KnackRawRecord>(
  view: KnackViewRef,
  recordId: string | undefined,
  options: { enabled?: boolean; staleTimeMs?: number } = {},
): UseQueryResult<T, KnackError> => {
  const { client } = useKnack();
  const { enabled = true, staleTimeMs = 30_000 } = options;

  return useQuery<T, KnackError, T>({
    queryKey: knackKeys.record(view, recordId ?? ''),
    queryFn: ({ signal }) => client.get<T>(view, recordId!, signal),
    enabled: enabled && Boolean(recordId),
    staleTime: staleTimeMs,
    retry: retryPolicy,
  });
};

export type KnackMutationInput =
  | { action: 'create'; data: Record<string, unknown> }
  | { action: 'update'; id: string; data: Record<string, unknown> }
  | { action: 'delete'; id: string };

export interface UseKnackMutationOptions {
  /**
   * Views to invalidate on success, beyond the one being written.
   * A create through a form view must refresh the table view that lists it —
   * they are different view keys, so this can't be inferred.
   */
  invalidates?: KnackViewRef[];
  onSuccess?: (result: unknown, input: KnackMutationInput) => void;
  onError?: (error: KnackError, input: KnackMutationInput) => void;
}

/**
 * Writes through a view. Knack uses separate views for create and update, so
 * pass whichever applies — usually from the generated `VIEWS` map.
 */
export const useKnackMutation = (
  views: { create?: KnackViewRef; update?: KnackViewRef; delete?: KnackViewRef },
  options: UseKnackMutationOptions = {},
): UseMutationResult<unknown, KnackError, KnackMutationInput> => {
  const { client } = useKnack();
  const queryClient = useQueryClient();

  return useMutation<unknown, KnackError, KnackMutationInput>({
    mutationFn: async (input) => {
      switch (input.action) {
        case 'create': {
          if (!views.create) throw missingView('create');
          return client.create(views.create, input.data);
        }
        case 'update': {
          if (!views.update) throw missingView('update');
          return client.update(views.update, input.id, input.data);
        }
        case 'delete': {
          const view = views.delete ?? views.update;
          if (!view) throw missingView('delete');
          return client.remove(view, input.id);
        }
      }
    },
    onSuccess: (result, input) => {
      const targets = [views.create, views.update, views.delete, ...(options.invalidates ?? [])];
      for (const view of targets) {
        if (view) void queryClient.invalidateQueries({ queryKey: knackKeys.view(view) });
      }
      options.onSuccess?.(result, input);
    },
    onError: options.onError,
    retry: false, // never silently repeat a write
  });
};

const missingView = (action: string): KnackError =>
  new KnackError(
    `No Knack view configured for "${action}". Add it to the entity manifest in ` +
      `knack.config.ts, create it in the Builder, then re-run \`npm run knack:sync\`.`,
    { status: 0, url: '' },
  );
