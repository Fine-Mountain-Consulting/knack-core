import { KnackError, knackErrorMessage } from './errors.js';
import type { KnackUser } from './types.js';
import { DEFAULT_API_HOST } from './viewClient.js';

const STORAGE_KEY = 'fmc.knack.session';

export interface KnackAuthConfig {
  appId: string;
  apiHost?: string;
  /**
   * sessionStorage by default — a Knack user token carries full user
   * authority, so scoping it to the tab limits the blast radius of an XSS bug.
   * Only move to localStorage with the client's explicit sign-off.
   */
  storage?: Storage;
}

export interface KnackSession {
  user: KnackUser;
}

interface SessionResponse {
  session?: {
    user?: {
      id?: string;
      email?: string;
      name?: string;
      token?: string;
      approval_status?: string;
      profile_keys?: string[];
      values?: Record<string, unknown>;
    };
  };
}

const safeStorage = (storage?: Storage): Storage | null => {
  if (storage) return storage;
  // Guarded: this module is imported by the CLI and by SSR builds, where
  // sessionStorage does not exist.
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

export class KnackAuth {
  private readonly appId: string;
  private readonly apiHost: string;
  private readonly storage: Storage | null;
  private cached: KnackUser | null | undefined;

  constructor(config: KnackAuthConfig) {
    this.appId = config.appId.trim();
    this.apiHost = (config.apiHost ?? DEFAULT_API_HOST).replace(/\/+$/, '');
    this.storage = safeStorage(config.storage);
  }

  /**
   * Exchange email + password for a Knack user token.
   *
   * Knack does not support SSO on this endpoint — accounts must have an
   * email/password. There is also no signup or password-reset equivalent;
   * link to the Knack app's own pages for those.
   */
  async login(email: string, password: string): Promise<KnackUser> {
    const url = `${this.apiHost}/applications/${this.appId}/session`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch (cause) {
      throw new KnackError(`Could not reach Knack to sign in: ${String(cause)}`, {
        status: 0,
        url,
      });
    }

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      throw new KnackError(
        // Knack's 400 here means bad credentials; say so rather than leaking
        // its raw wording into the login form.
        response.status === 400 || response.status === 401
          ? 'Incorrect email or password.'
          : knackErrorMessage(body, `Sign-in failed (${response.status}).`),
        { status: response.status, body, url },
      );
    }

    const raw = (body as SessionResponse)?.session?.user;
    if (!raw?.token) {
      throw new KnackError('Knack sign-in returned no user token.', {
        status: response.status,
        body,
        url,
      });
    }

    const user: KnackUser = {
      id: raw.id ?? '',
      email: raw.email ?? email,
      name: raw.name,
      token: raw.token,
      profileKeys: raw.profile_keys ?? [],
      approvalStatus: raw.approval_status,
      values: raw.values,
    };

    this.persist(user);
    return user;
  }

  /** The stored session, or null. Reads through a memo after the first hit. */
  getUser(): KnackUser | null {
    if (this.cached !== undefined) return this.cached;

    const stored = this.storage?.getItem(STORAGE_KEY);
    if (!stored) {
      this.cached = null;
      return null;
    }
    try {
      const user = JSON.parse(stored) as KnackUser;
      this.cached = user?.token ? user : null;
    } catch {
      // Corrupt payload — drop it rather than wedging the app on every load.
      this.storage?.removeItem(STORAGE_KEY);
      this.cached = null;
    }
    return this.cached;
  }

  getToken(): string | null {
    return this.getUser()?.token ?? null;
  }

  logout(): void {
    this.cached = null;
    this.storage?.removeItem(STORAGE_KEY);
  }

  private persist(user: KnackUser): void {
    this.cached = user;
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch {
      // Private browsing or a full quota. The session still works for this
      // page load; it just won't survive a refresh.
    }
  }
}

/** Map Knack profile keys to the app's own role names. */
export const rolesFromProfileKeys = <R extends string>(
  profileKeys: string[],
  roleMap: Record<string, R>,
): R[] => {
  const roles = profileKeys.map((key) => roleMap[key]).filter((r): r is R => Boolean(r));
  return [...new Set(roles)];
};
