'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getCurrentUser, fetchUserAttributes, signOut as amplifySignOut } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { configureAmplify } from '@/lib/amplify';

configureAmplify();

interface AuthContextValue {
  user: { email: string; tenantId: string; userId: string } | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthContextValue['user']>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      await getCurrentUser();
      const attributes = await fetchUserAttributes();
      setUser({
        email: attributes.email ?? '',
        userId: attributes.sub ?? '',
        tenantId: attributes['custom:tenant_id'] ?? '',
      });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    await amplifySignOut();
    setUser(null);
  }, []);

  useEffect(() => {
    loadUser();

    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn') {
        loadUser();
      } else if (payload.event === 'signedOut') {
        setUser(null);
      }
    });

    return unsubscribe;
  }, [loadUser]);

  return (
    <AuthContext.Provider value={{ user, loading, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
