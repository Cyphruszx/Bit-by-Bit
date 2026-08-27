"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { hydrateCloudSession } from "@/lib/persist/hydrate";
import { getPersistStatus, subscribePersistStatus } from "@/lib/persist/runtime";
import { wipeLocalFinanceKeys } from "@/lib/persist/keys";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export type SessionUser = {
  id: string;
  email: string | null;
};

type SessionState = {
  user: SessionUser | null;
  cloudConfigured: boolean;
  hydrating: boolean;
  persistError: string | null;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({
  children,
  initialUser,
  cloudConfigured,
}: {
  children: React.ReactNode;
  initialUser: SessionUser | null;
  cloudConfigured: boolean;
}) {
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const persist = useSyncExternalStore(subscribePersistStatus, getPersistStatus, getPersistStatus);

  useEffect(() => {
    if (!cloudConfigured) return;
    const supabase = createBrowserSupabaseClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user ? { id: session.user.id, email: session.user.email ?? null } : null;
      setUser(nextUser);
      if (event === "SIGNED_OUT") wipeLocalFinanceKeys();
      void hydrateCloudSession(nextUser?.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, [cloudConfigured]);

  const value = useMemo<SessionState>(
    () => ({
      user,
      cloudConfigured,
      hydrating: persist.hydrating,
      persistError: persist.error,
    }),
    [user, cloudConfigured, persist.hydrating, persist.error],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within SessionProvider");
  return value;
}
