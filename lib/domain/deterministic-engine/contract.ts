/**
 * PR4-A/B/C/D — Deterministic engine contract (structural only).
 * Shadow/probe/parity; PR4-D adds shared authoritative call-event source helper (no semantic change).
 * PR4-E adds scoring-lineage parity (session V1.1 vs brain score), metrics/logs only.
 */

/** Bump when probe payload or parity semantics change. */
export const ENGINE_CONTRACT_VERSION = 'pr4e.1' as const;

/** Single instrumented surface in PR4-A. */
export type DeterministicEngineProbeKind = 'attribution_resolve';

/** PR4-B: binary comparable surface for attribution vs traffic classifier (shadow only). */
export type PaidSurfaceBucket = 'paid' | 'organic';
