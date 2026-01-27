
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Using service role for the test script to ensure DB connectivity, though RPC is SECURITY INVOKER

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const SITE_ID = process.env.STATS_SITE_ID;
const DAYS = parseInt(process.env.STATS_DAYS || '7', 10);

if (!SITE_ID) {
    console.error('❌ Error: STATS_SITE_ID environment variable is required');
    process.exit(1);
}

async function testStatsRpc() {
    console.log(`🚀 Testing get_dashboard_stats RPC for Site: ${SITE_ID}, Days: ${DAYS}...`);

    // v2.2: Use date_from/date_to instead of p_days
    const dateTo = new Date();
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - DAYS);
    
    const { data, error } = await supabase.rpc('get_dashboard_stats', {
        p_site_id: SITE_ID,
        p_date_from: dateFrom.toISOString(),
        p_date_to: dateTo.toISOString()
    });

    if (error) {
        console.error('❌ RPC Error:', error.message);
        if (error.message.includes('function public.get_dashboard_stats(uuid, integer) does not exist')) {
            console.log('💡 Note: You need to push the migration to the database first.');
        }
        process.exit(1);
    }

    console.log('✅ RPC Result:', JSON.stringify(data, null, 2));

    // Assertions
    const requiredKeys = [
        'site_id', 'range_days', 'total_calls', 'total_events',
        'total_sessions', 'unique_visitors', 'confirmed_calls',
        'conversion_rate'
    ];

    let missing = false;
    requiredKeys.forEach(key => {
        if (!(key in data)) {
            console.error(`❌ Assertion Failed: Missing key "${key}"`);
            missing = true;
        }
    });

    if (!missing) {
        console.log('✅ All required keys exist.');

        // Type checks
        const numericKeys = [
            'range_days', 'total_calls', 'total_events',
            'total_sessions', 'unique_visitors', 'confirmed_calls',
            'conversion_rate'
        ];

        numericKeys.forEach(key => {
            if (typeof data[key] !== 'number') {
                console.error(`❌ Assertion Failed: Key "${key}" should be a number, got "${typeof data[key]}"`);
            }
        });

        console.log('✅ Final status: PASS');
    } else {
        process.exit(1);
    }
}

testStatsRpc();
