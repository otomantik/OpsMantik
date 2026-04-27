import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { logError, logInfo } from '@/lib/logging/logger';
import { parseCreateSitePayload } from '@/lib/validation/site-create';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { ensureDefaultSiteActiveModules, DEFAULT_SITE_ACTIVE_MODULES } from '@/lib/types/modules';

function buildOriginCandidates(domain: string): string[] {
  const clean = domain.trim().toLowerCase().replace(/^www\./, '');
  if (!clean) return [];
  const origins = new Set<string>();
  origins.add(`https://${clean}`);
  origins.add(`https://www.${clean}`);
  return Array.from(origins);
}

async function seedSiteAllowedOrigins(siteId: string, domain: string): Promise<void> {
  const candidates = buildOriginCandidates(domain);
  if (candidates.length === 0) return;

  const rows = candidates.map((origin) => ({
    site_id: siteId,
    origin,
    status: 'active',
    verification_state: 'trusted',
  }));

  const { error } = await adminClient
    .from('site_allowed_origins')
    .upsert(rows, { onConflict: 'site_id,origin', ignoreDuplicates: false });

  if (error && error.code !== '42P01') {
    logError('SITES_CREATE_ORIGIN_SEED_FAILED', { message: error.message, code: error.code });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimit = await RateLimitService.checkWithMode(
      `sites-create:${RateLimitService.getClientId(req)}`,
      20,
      60_000,
      { namespace: 'sites_create', mode: 'fail-closed', fallbackMaxRequests: 5 }
    );
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // Validate user is logged in
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const bodyUnknown = await req.json().catch(() => ({}));
    let payload;
    try {
      payload = parseCreateSitePayload(bodyUnknown);
    } catch (validationError) {
      return NextResponse.json(
        { error: validationError instanceof Error ? validationError.message : 'Invalid request payload' },
        { status: 400 }
      );
    }
    const {
      name: trimmedName,
      domain: normalizedDomain,
      locale,
      default_country_iso: defaultCountryIso,
      timezone,
      currency,
    } = payload;

    if (!trimmedName) {
      return NextResponse.json(
        { error: 'Name cannot be empty' },
        { status: 400 }
      );
    }

    // Guardrail: if this user already has a matching site, update it instead of creating a new row.
    // This prevents accidental duplicate sites during domain/brand changes.
    // Matching rules (in order):
    // 1) Exact domain match for this user
    // 2) Exact name match (case-insensitive) for this user
    const { data: existingSites, error: listErr } = await adminClient
      .from('sites')
      .select('id, name, domain, public_id')
      .eq('user_id', user.id);

    if (listErr) {
      logError('SITES_CREATE_LIST_FAILED', { message: listErr.message, code: (listErr as { code?: string })?.code });
      return NextResponse.json(
        { error: 'Failed to load sites. Check server configuration (Supabase URL and service role key).', code: 'LIST_FAILED' },
        { status: 500 }
      );
    }

    const domainLower = normalizedDomain.toLowerCase();
    const nameLower = trimmedName.toLowerCase();
    const matchByDomain = (existingSites || []).find((s) =>
      typeof s?.domain === 'string' && s.domain.trim().toLowerCase() === domainLower
    );
    const matchByName = (existingSites || []).find((s) =>
      typeof s?.name === 'string' && s.name.trim().toLowerCase() === nameLower
    );
    const matched = matchByDomain || matchByName;

    if (matched?.id) {
      const { data: rowForMods } = await adminClient
        .from('sites')
        .select('active_modules')
        .eq('id', matched.id)
        .single();
      const priorMods = rowForMods && 'active_modules' in rowForMods ? rowForMods.active_modules : undefined;
      const active_modules = ensureDefaultSiteActiveModules(
        Array.isArray(priorMods) ? priorMods : undefined
      );
      const { data: updated, error: updateErr } = await adminClient
        .from('sites')
        .update({
          name: trimmedName,
          domain: normalizedDomain,
          locale,
          default_country_iso: defaultCountryIso,
          timezone,
          currency,
          active_modules,
        })
        .eq('id', matched.id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updateErr) {
        const err = updateErr as { code?: string; message?: string; details?: string };
        logError('SITES_CREATE_UPDATE_FAILED', { code: err?.code, message: err?.message, details: err?.details });
        const msg = err?.code === '23505' ? 'A site with this name or domain already exists.' : 'Failed to update site. Please try again.';
        return NextResponse.json(
          { error: msg, code: 'UPDATE_FAILED' },
          { status: 500 }
        );
      }

      await seedSiteAllowedOrigins(matched.id, normalizedDomain);
      logInfo('SITES_CREATE_UPDATED', {
        user_id: user.id,
        site_id: matched.id,
        route: '/api/sites/create',
      });

      return NextResponse.json({
        success: true,
        site: updated,
        message: 'Site updated successfully',
        updated: true,
      });
    }

    // Generate public_id using crypto.randomUUID() without dashes
    // Edge Runtime compatible: crypto is available globally
    let publicId: string;
    let attempts = 0;
    const maxAttempts = 5;

    do {
      // Use globalThis.crypto for Edge Runtime compatibility
      const uuid = globalThis.crypto.randomUUID();
      publicId = uuid.replace(/-/g, '');
      attempts++;

      // Check if this public_id already exists
      const { data: existingSite } = await adminClient
        .from('sites')
        .select('id')
        .eq('public_id', publicId)
        .maybeSingle();

      if (!existingSite) {
        break; // Unique ID found
      }

      if (attempts >= maxAttempts) {
        return NextResponse.json(
          { error: 'Failed to generate unique site ID. Please try again.' },
          { status: 500 }
        );
      }
    } while (attempts < maxAttempts);

    // Create new site with user_id from authenticated user
    const { data: newSite, error: createError } = await adminClient
      .from('sites')
      .insert({
        user_id: user.id, // Security: Always use authenticated user's ID
        name: trimmedName,
        domain: normalizedDomain,
        public_id: publicId,
        locale,
        default_country_iso: defaultCountryIso,
        timezone,
        currency,
        active_modules: [...DEFAULT_SITE_ACTIVE_MODULES],
      })
      .select()
      .single();

    if (createError) {
      const err = createError as { code?: string; message?: string; details?: string };
      logError('SITES_CREATE_INSERT_FAILED', { code: err?.code, message: err?.message, details: err?.details });
      let msg: string;
      if (err?.code === '23505') {
        msg = 'A site with this domain or ID already exists.';
      } else if (err?.code === '42703') {
        msg = 'Database schema mismatch: a required column may be missing. Run all Supabase migrations (supabase db push or apply migrations).';
      } else if (err?.code === 'PGRST301' || (err?.message && err.message.includes('relation'))) {
        msg = 'sites table or RLS may be missing. Run Supabase migrations.';
      } else {
        msg = `Failed to create site. (${err?.code ?? 'unknown'}) Check Vercel logs for SITES_CREATE_INSERT_FAILED.`;
      }
      return NextResponse.json(
        { error: msg, code: 'INSERT_FAILED', dbCode: err?.code ?? undefined },
        { status: 500 }
      );
    }

    await seedSiteAllowedOrigins(newSite.id, normalizedDomain);
    logInfo('SITES_CREATE_SUCCESS', {
      user_id: user.id,
      site_id: newSite.id,
      route: '/api/sites/create',
    });

    return NextResponse.json({
      success: true,
      site: newSite,
      message: 'Site created successfully',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('SITES_CREATE_EXCEPTION', { error: message, stack: error instanceof Error ? error.stack : undefined });
    const isEnvMissing = typeof message === 'string' && message.includes('Missing required environment variables');
    const clientMessage = isEnvMissing
      ? 'Server misconfiguration: Supabase URL or service role key not set. Check Vercel environment variables.'
      : 'Something went wrong. Check server logs (Vercel Functions) for SITES_CREATE_EXCEPTION.';
    return NextResponse.json(
      { error: clientMessage, code: isEnvMissing ? 'CONFIG_MISSING' : 'SERVER_ERROR' },
      { status: isEnvMissing ? 503 : 500 }
    );
  }
}
