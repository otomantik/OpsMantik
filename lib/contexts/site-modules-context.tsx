'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { OpsMantikModule } from '@/lib/types/modules';

export interface SiteModulesContextValue {
  siteId: string;
  activeModules: OpsMantikModule[];
}

const SiteModulesContext = createContext<SiteModulesContextValue | null>(null);

export function SiteModulesProvider({
  siteId,
  activeModules,
  children,
}: {
  siteId: string;
  activeModules: OpsMantikModule[];
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({ siteId, activeModules }),
    [siteId, activeModules.join(',')]
  );
  return (
    <SiteModulesContext.Provider value={value}>
      {children}
    </SiteModulesContext.Provider>
  );
}

export function useSiteModules(): SiteModulesContextValue | null {
  return useContext(SiteModulesContext);
}
