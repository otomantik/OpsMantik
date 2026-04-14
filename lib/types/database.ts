/**
 * Database types for public tables (GO1 Casino Kasa + existing).
 * Use these for type-safe updates. For full generated types run: npx supabase gen types typescript --project-id <ref> > lib/types/database.types.ts
 */

/** Allowed call columns for authenticated UPDATE (RLS + trigger enforced) */
export type CallUpdatableFields = {
  sale_amount?: number | null;
  estimated_value?: number | null;
  currency?: string;
  status?: string | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  note?: string | null;
  lead_score?: number | null;
  oci_status?: string | null;
  oci_status_updated_at?: string | null;
};

/** Call row shape (minimal for Casino Kasa + existing) */
export interface CallRow {
  id: string;
  site_id: string;
  created_at: string;
  sale_amount?: number | null;
  estimated_value?: number | null;
  currency: string;
  status?: string | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  note?: string | null;
  lead_score?: number | null;
  oci_status?: string | null;
  oci_status_updated_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

/** Dynamic sector playbook stage (pipeline_stages JSONB) for Universal CRM / God Mode */
export interface PipelineStage {
  id: string; // e.g., 'g_trash', 'g_1', 'g_2', 'g_3', 'g_4'
  label: string; // UI display name (e.g., 'Kitle Ölücü', 'İş Oldu')
  multiplier?: number; // e.g., 0.05, 0.10, 0.30, 1.0. Applied against site's base deal value. Optional for backward calc
  action?: 'discard' | 'oci_ping'; // discard for junk, oci_ping for gears
  color: string; // Tailwind color token (e.g., 'rose', 'orange', 'blue', 'emerald')
  order: number; // Funnel rendering order (0 for trash, 1-4 for gears)
  value_cents?: number; // Legacy/Fallback hardcoded value
  is_macro?: boolean; // True if this is the ultimate goal (e.g., Sale)
  is_system?: boolean; // If true, the user cannot delete this stage from the UI
}

/** Per-site config (sites.config jsonb): bounty chip values, UI knobs */
export interface SiteConfig {
  /** Bounty chip values: array e.g. [1000, 5000, 10000, 25000] or keyed object */
  bounty_chips?: number[] | Record<string, number>;
  currency?: string;
  [key: string]: unknown;
}

/** Tenant feature entitlements (see lib/types/modules.ts) */
export type SiteActiveModules = string[];

/** Sites row shape (minimal for config + proxy value) */
export interface SiteRow {
  id: string;
  user_id: string;
  config: SiteConfig;
  /** Average deal revenue; used for proxy value when sale_amount is not entered (Lazy Antiques Dealer). */
  default_deal_value?: number | null;
  /** Dynamic sector playbook: macro/micro conversion stages for OCI */
  pipeline_stages?: PipelineStage[] | null;
  /** Enabled feature modules for this tenant (e.g. core_oci, scoring_v1, google_ads_spend) */
  active_modules?: SiteActiveModules | null;
  [key: string]: unknown;
}
