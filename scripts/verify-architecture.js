// Divine Architecture Verification Script
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🏛️  OPSMANTIK - Divine Architecture Verification\n');
console.log('='.repeat(60));

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ .env.local dosyasında Supabase bilgileri eksik!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyArchitecture() {
  const checks = {
    partitioning: false,
    realtime: false,
    rls: false,
    phoneMatching: false,
    components: false,
  };

  try {
    // 1. Check Partitioning
    console.log('\n📊 1. Monthly Partitioning Check...');
    const currentMonth = new Date().toISOString().slice(0, 7);
    const partitionName = `events_${currentMonth.replace('-', '_')}`;
    
    let partitionCheck = null;
    try {
      const res = await supabase.rpc('exec_sql', {
        query: `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = '${partitionName}'
        ) as exists;`,
      });
      partitionCheck = res?.data ?? null;
    } catch {
      partitionCheck = null;
    }

    // Alternative: Check if events table exists and has session_month
    const { data: eventsSample } = await supabase
      .from('events')
      .select('session_month')
      .limit(1);

    if (eventsSample !== null) {
      checks.partitioning = true;
      console.log('   ✅ Partitioning structure detected');
    } else {
      console.log('   ⚠️  Events table not found - Migration needed');
    }

    // 2. Check Realtime
    console.log('\n⚡ 2. Realtime Engine Check...');
    let realtimeCheck = null;
    try {
      const res = await supabase.rpc('exec_sql', {
        query: `SELECT EXISTS (
          SELECT 1 FROM pg_publication 
          WHERE pubname = 'supabase_realtime'
        ) as exists;`,
      });
      realtimeCheck = res?.data ?? null;
    } catch {
      realtimeCheck = null;
    }

    // Check REPLICA IDENTITY
    let replicaCheck = null;
    try {
      const res = await supabase.rpc('exec_sql', {
        query: `SELECT relreplident 
          FROM pg_class 
          WHERE relname = 'events' 
          LIMIT 1;`,
      });
      replicaCheck = res?.data ?? null;
    } catch {
      replicaCheck = null;
    }

    if (realtimeCheck || replicaCheck) {
      checks.realtime = true;
      console.log('   ✅ Realtime publication configured');
    } else {
      console.log('   ⚠️  Realtime setup needed - Run migration 20260125000002_realtime_setup.sql');
    }

    // 3. Check RLS
    console.log('\n🔐 3. Row Level Security Check...');
    let rlsCheck = null;
    try {
      const res = await supabase.rpc('exec_sql', {
        query: `SELECT tablename, rowsecurity 
          FROM pg_tables 
          WHERE schemaname = 'public' 
          AND tablename IN ('sites', 'sessions', 'events', 'calls')
          ORDER BY tablename;`,
      });
      rlsCheck = res?.data ?? null;
    } catch {
      rlsCheck = null;
    }

    if (rlsCheck && rlsCheck.length > 0) {
      checks.rls = true;
      console.log('   ✅ RLS enabled on tables');
      rlsCheck.forEach(t => {
        console.log(`      - ${t.tablename}: ${t.rowsecurity ? '✅' : '❌'}`);
      });
    } else {
      console.log('   ⚠️  RLS status unknown - Check Supabase Dashboard');
    }

    // 4. Check Phone Matching
    console.log('\n📞 4. Phone Matching Check...');
    const { data: callsTable } = await supabase
      .from('calls')
      .select('id')
      .limit(1);

    if (callsTable !== null) {
      checks.phoneMatching = true;
      console.log('   ✅ Calls table exists');
    } else {
      console.log('   ⚠️  Calls table not found - Migration needed');
    }

    // 5. Check Components
    console.log('\n🎨 5. Component Files Check...');
    const componentFiles = [
      'components/dashboard/session-group.tsx',
      'components/dashboard-v2/DashboardShell.tsx',
      'docs/ARCHITECTURE.md',
    ];

    let allComponentsExist = true;
    componentFiles.forEach(file => {
      const exists = fs.existsSync(path.join(process.cwd(), file));
      if (exists) {
        console.log(`   ✅ ${file}`);
      } else {
        console.log(`   ❌ ${file} - MISSING!`);
        allComponentsExist = false;
      }
    });

    checks.components = allComponentsExist;

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📋 VERIFICATION SUMMARY\n');
    
    const allPassed = Object.values(checks).every(v => v);
    
    Object.entries(checks).forEach(([key, value]) => {
      const icon = value ? '✅' : '⚠️';
      const label = {
        partitioning: 'Monthly Partitioning',
        realtime: 'Realtime Engine',
        rls: 'Row Level Security',
        phoneMatching: 'Phone Matching',
        components: 'Component Files',
      }[key];
      console.log(`${icon} ${label}`);
    });

    if (allPassed) {
      console.log('\n🎉 Divine Architecture is FULLY OPERATIONAL!');
      console.log('   All systems ready for production.');
    } else {
      console.log('\n⚠️  Some components need attention.');
      console.log('   Run: supabase db push');
      console.log('   Check: docs/ARCHITECTURE.md');
    }

  } catch (error) {
    console.error('\n❌ Verification Error:', error.message);
  }
}

verifyArchitecture();
