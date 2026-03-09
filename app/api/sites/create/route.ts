import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging/logger';

export async function POST(req: NextRequest) {
  try {
    // Validate user is logged in
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await req.json();
    const { name, domain } = body;

    // Validate required fields
    if (!name || !domain) {
      return NextResponse.json(
        { error: 'Name and domain are required' },
        { status: 400 }
      );
    }

    // Normalize domain: strip protocol, path, and normalize to hostname
    let normalizedDomain = domain.trim();
    try {
      // Remove protocol if present
      normalizedDomain = normalizedDomain.replace(/^https?:\/\//, '');
      // Remove path if present
      normalizedDomain = normalizedDomain.split('/')[0];
      // Remove port if present (for localhost cases, keep it)
      // Actually, keep port for localhost:3000 cases
      normalizedDomain = normalizedDomain.trim();
    } catch {
      return NextResponse.json(
        { error: 'Invalid domain format' },
        { status: 400 }
      );
    }

    if (!normalizedDomain) {
      return NextResponse.json(
        { error: 'Domain cannot be empty' },
        { status: 400 }
      );
    }

    const trimmedName = String(name).trim();
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
      const { data: updated, error: updateErr } = await adminClient
        .from('sites')
        .update({
          name: trimmedName,
          domain: normalizedDomain,
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
