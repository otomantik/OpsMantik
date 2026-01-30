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

/** Per-site config (sites.config jsonb): bounty chip values, UI knobs */
export interface SiteConfig {
  /** Bounty chip values: array e.g. [1000, 5000, 10000, 25000] or keyed object */
  bounty_chips?: number[] | Record<string, number>;
  currency?: string;
  [key: string]: unknown;
}

/** Sites row shape (minimal for config) */
export interface SiteRow {
  id: string;
  user_id: string;
  config: SiteConfig;
  [key: string]: unknown;
}
