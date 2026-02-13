import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';

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
      console.error('[SITES_CREATE] Failed to list sites for upsert:', listErr);
      return NextResponse.json(
        { error: 'Failed to validate existing sites' },
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
        console.error('[SITES_CREATE] Update existing site failed:', updateErr);
        return NextResponse.json(
          { error: 'Failed to update site', details: updateErr.message },
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
      console.error('[SITES_CREATE] Error:', createError);
      return NextResponse.json(
        { error: 'Failed to create site', details: createError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      site: newSite,
      message: 'Site created successfully',
    });
  } catch (error: unknown) {
    console.error('[SITES_CREATE] Exception:', error);
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Internal server error', details },
      { status: 500 }
    );
  }
}
