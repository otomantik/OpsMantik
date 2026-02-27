import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './admin';

/**
 * Tenant-Aware Supabase Client Factory.
 * Enforces a strict .eq('site_id', siteId) filter for every query via a Proxy
 * to prevent accidental cross-tenant data leakage in background workers.
 *
 * Connection resilience (Sprint 3): This wrapper uses the admin REST client; it does not
 * open direct Postgres connections. For direct SQL (e.g. serverless driver), use the
 * Supabase Transaction Pooler (port 6543) and apply query timeouts for reporting (e.g. 10s).
 */
export function createTenantClient(siteId: string): SupabaseClient {
    if (!siteId) {
        throw new Error('TenantClient failure: siteId is required for isolation.');
    }

    // We wrap the adminClient (Service Role) in a Proxy that intercepts 
    // .from('table') and .rpc() calls to enforce isolation.
    return new Proxy(adminClient, {
        get(target, prop, receiver) {
            const original = Reflect.get(target, prop, receiver);

            // Intercept RPC calls
            if (prop === 'rpc') {
                return (name: string, params?: Record<string, unknown>) => {
                    const pSiteId = params?.site_id || params?.p_site_id;
                    if (!pSiteId || pSiteId !== siteId) {
                        console.error(`[TENANT_CLIENT_RPC_GUARD] Violation in '${name}': site_id missing or mismatch.`);
                        throw new Error('HARD_SECURITY_ERROR: RPC calls via TenantClient must include valid site_id.');
                    }
                    const rpcFunc = original as (name: string, params?: Record<string, unknown>) => unknown;
                    return rpcFunc.apply(target, [name, params]);
                };
            }

            if (prop === 'from') {
                return (table: string) => {
                    const fromFunc = original as (table: string) => {
                        insert: (v: unknown, o?: unknown) => unknown;
                        upsert: (v: unknown, o?: unknown) => unknown;
                        select: (...args: unknown[]) => { eq: (c: string, v: unknown) => unknown };
                        update: (...args: unknown[]) => { eq: (c: string, v: unknown) => unknown };
                        delete: (...args: unknown[]) => { eq: (c: string, v: unknown) => unknown };
                    };
                    const query = fromFunc.apply(target, [table]);

                    return new Proxy(query, {
                        get(qTarget, qProp, qReceiver) {
                            const qOriginal = Reflect.get(qTarget, qProp, qReceiver);

                            // Intercept mutations: insert/upsert
                            if (['insert', 'upsert'].includes(qProp as string)) {
                                return (values: Record<string, unknown> | Record<string, unknown>[], options?: unknown) => {
                                    const rows = Array.isArray(values) ? values : [values];
                                    for (const r of rows) {
                                        if (!r.site_id || r.site_id !== siteId) {
                                            console.error(`[TENANT_CLIENT_INSERT_GUARD] Violation in '${table}': site_id missing or mismatch.`);
                                            throw new Error('HARD_SECURITY_ERROR: Mutations via TenantClient must include valid site_id.');
                                        }
                                    }
                                    const mutationFunc = qOriginal as (v: unknown, o?: unknown) => unknown;
                                    return mutationFunc.apply(qTarget, [values, options]);
                                };
                            }

                            // Intercept filters: select/update/delete/upsert_filter
                            if (['select', 'update', 'delete', 'upsert'].includes(qProp as string)) {
                                return (...args: unknown[]) => {
                                    // Protect against manual .eq('site_id', ...) overrides
                                    const filterFunc = qOriginal as (...args: unknown[]) => { eq: (col: string, val: unknown) => unknown };
                                    const builder = filterFunc.apply(qTarget, args);
                                    return builder.eq('site_id', siteId);
                                };
                            }

                            // Block manual .eq('site_id', ...) calls to prevent tampering with enforced filters
                            if (qProp === 'eq') {
                                return (column: string, value: unknown) => {
                                    if (column === 'site_id' && value !== siteId) {
                                        throw new Error('HARD_SECURITY_ERROR: Cannot override site_id filter via TenantClient.');
                                    }
                                    const eqFunc = qOriginal as (col: string, val: unknown) => unknown;
                                    return eqFunc.apply(qTarget, [column, value]);
                                };
                            }

                            return typeof qOriginal === 'function' ? qOriginal.bind(qTarget) : qOriginal;
                        }
                    });
                };
            }

            return typeof original === 'function' ? original.bind(target) : original;
        },
    }) as unknown as SupabaseClient;
}
