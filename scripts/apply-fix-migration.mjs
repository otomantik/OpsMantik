
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
  const sql = fs.readFileSync('supabase/migrations/20260430205000_fix_intent_persistence_v2.sql', 'utf8');
  console.log('Applying migration...');
  
  // Try to execute the SQL via a helper if exists, or just use rpc('pg_query_v1')
  const { error } = await supabase.rpc('pg_query_v1', { p_query: sql });
  
  if (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
  
  console.log('Migration applied successfully.');
}

applyMigration();
