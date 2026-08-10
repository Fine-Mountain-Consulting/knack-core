import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KnackAuth, rolesFromProfileKeys } from '../auth.js';
import { KnackViewClient } from '../viewClient.js';
import type { KnackUser } from '../types.js';

export interface KnackContextValue<R extends string = string> {
  client: KnackViewClient;
  user: KnackUser | null;
  roles: R[];
  /** Method shorthand, deliberately: it gives bivariant parameter checking,
   *  which is what lets the provider store a widened context internally while
   *  callers read it back at their own role union. */
  hasRole(...roles: R[]): boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<KnackUser>;
  logout: () => void;
}

const KnackContext = createContext<KnackContextValue<string> | null>(null);

export interface KnackProviderProps<R extends string = string> {
  appId: string;
  /** Maps Knack profile keys (`object_5`) to app role names (`admin`). */
  roleMap: Record<string, R>;
  /** Override for GovCloud/HIPAA tenants. */
  apiHost?: string;
  children: ReactNode;
}

export const KnackProvider = <R extends string = string>({
  appId,
  roleMap,
  apiHost,
  children,
}: KnackProviderProps<R>) => {
  const queryClient = useQueryClient();
  const auth = useMemo(() => new KnackAuth({ appId, apiHost }), [appId, apiHost]);
  const [user, setUser] = useState<KnackUser | null>(() => auth.getUser());

  // The client reads the token through a ref-stable getter so a login or
  // logout never has to rebuild it — rebuilding would change the query
  // functions' identity and refetch the whole app.
  const authRef = useRef(auth);
  authRef.current = auth;

  const logout = useCallback(() => {
    authRef.current.logout();
    setUser(null);
    // Without this the next user in the same tab sees the previous user's
    // cached records before their own load.
    queryClient.clear();
  }, [queryClient]);

  const client = useMemo(
    () =>
      new KnackViewClient({
        appId,
        apiHost,
        getToken: () => authRef.current.getToken(),
        onAuthError: () => logout(),
      }),
    [appId, apiHost, logout],
  );

  const login = useCallback(async (email: string, password: string) => {
    const next = await authRef.current.login(email, password);
    setUser(next);
    return next;
  }, []);

  const value = useMemo<KnackContextValue<R>>(() => {
    const roles = user ? rolesFromProfileKeys(user.profileKeys, roleMap) : [];
    return {
      client,
      user,
      roles,
      hasRole: (...wanted: R[]) => wanted.some((r) => roles.includes(r)),
      isAuthenticated: Boolean(user?.token),
      login,
      logout,
    };
  }, [client, user, roleMap, login, logout]);

  return (
    <KnackContext.Provider value={value as KnackContextValue<string>}>
      {children}
    </KnackContext.Provider>
  );
};

export const useKnack = <R extends string = string>(): KnackContextValue<R> => {
  const ctx = useContext(KnackContext);
  if (!ctx) throw new Error('useKnack must be used inside <KnackProvider>.');
  return ctx as KnackContextValue<R>;
};
