#!/usr/bin/env node
/**
 * Check geo (city/district) history in last 7 days
 * Usage: node scripts/check-geo-history.mjs
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

async function checkGeoHistory() {
  console.log('🔍 Checking geo (city/district) history in last 7 days...\n');

  // Check overall stats using direct query
  const { data: statsRaw, error: statsErr } = await adminClient
    .from('sessions')
    .select('id, city, district, created_at')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (statsErr) {
    console.error('❌ Stats query failed:', statsErr);
    return;
  }

  const withCity = statsRaw.filter(s => s.city !== null).length;
  const withoutCity = statsRaw.filter(s => s.city === null).length;
  const totalSessions = statsRaw.length;
  const uniqueCities = new Set(statsRaw.filter(s => s.city).map(s => s.city)).size;
  const earliest = statsRaw.length > 0 ? statsRaw.reduce((min, s) => s.created_at < min ? s.created_at : min, statsRaw[0].created_at) : null;
  const latest = statsRaw.length > 0 ? statsRaw.reduce((max, s) => s.created_at > max ? s.created_at : max, statsRaw[0].created_at) : null;

  const stat = {
    with_city: withCity,
    without_city: withoutCity,
    total_sessions: totalSessions,
    unique_cities: uniqueCities,
    earliest,
    latest
  };
  console.log('📊 Last 7 days stats:');
  console.log(`  Total sessions: ${stat.total_sessions}`);
  console.log(`  With city: ${stat.with_city} (${((stat.with_city / stat.total_sessions) * 100).toFixed(1)}%)`);
  console.log(`  Without city: ${stat.without_city} (${((stat.without_city / stat.total_sessions) * 100).toFixed(1)}%)`);
  console.log(`  Unique cities: ${stat.unique_cities}`);
  console.log(`  Date range: ${stat.earliest} → ${stat.latest}\n`);

  // Sample sessions with city
  if (stat.with_city > 0) {
    const { data: withCity, error: cityErr } = await adminClient
      .from('sessions')
      .select('id, city, district, created_at, attribution_source')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .not('city', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5);

    if (cityErr) {
      console.error('❌ Sample query failed:', cityErr);
    } else {
      console.log('✅ Sample sessions WITH city (most recent 5):');
      withCity.forEach(s => {
        console.log(`  ${s.created_at} | ${s.city || 'null'}, ${s.district || 'null'} | ${s.attribution_source || 'unknown'}`);
      });
      console.log('');
    }
  }

  // Check today specifically
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { data: todayRaw, error: todayErr } = await adminClient
    .from('sessions')
    .select('id, city')
    .gte('created_at', todayStart.toISOString());

  if (!todayErr && todayRaw) {
    const totalToday = todayRaw.length;
    const withCityToday = todayRaw.filter(s => s.city !== null).length;
    console.log(`📅 Today (UTC day): ${totalToday} sessions, ${withCityToday} with city (${totalToday > 0 ? ((withCityToday / totalToday) * 100).toFixed(1) : '0.0'}%)\n`);
  }

  // Verdict
  if (stat.with_city === 0) {
    console.log('❌ NO sessions with city in last 7 days → all requests from localhost or no Vercel headers');
    console.log('   → Deploy to Vercel and test from real site (not localhost)\n');
  } else if (stat.with_city > 0 && stat.without_city > stat.with_city) {
    console.log('⚠️  MIXED: Some sessions have city, but majority do not');
    console.log('   → Likely: some requests from localhost, some from production\n');
  } else {
    console.log('✅ Most sessions have city → geo enrichment working\n');
  }
}

checkGeoHistory().catch(err => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
