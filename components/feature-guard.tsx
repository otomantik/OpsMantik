'use client';

import React from 'react';
import type { OpsMantikModule } from '@/lib/types/modules';
import { useSiteModules } from '@/lib/contexts/site-modules-context';

export interface FeatureGuardProps {
  requiredModule: OpsMantikModule;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Renders children only if the current site has the required module in active_modules.
 * Otherwise renders fallback (e.g. UpsellUI). Use inside dashboard where SiteModulesProvider is set.
 */
export function FeatureGuard({ requiredModule, fallback = null, children }: FeatureGuardProps) {
  const ctx = useSiteModules();

  if (!ctx) {
    return <>{fallback}</>;
  }

  const hasModule = Array.isArray(ctx.activeModules) && ctx.activeModules.includes(requiredModule);
  if (hasModule) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
