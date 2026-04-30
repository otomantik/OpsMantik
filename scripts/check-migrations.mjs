
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMigrations() {
  console.log('Checking migration status...');
  
  const { data, error } = await supabase
    .from('_migrations')
    .select('*')
    .order('version', { ascending: false })
    .limit(5);

  if (error) {
    // Try supabase_migrations table
    const { data: data2, error: error2 } = await supabase
      .from('supabase_migrations')
      .select('*')
      .order('version', { ascending: false })
      .limit(5);
      
    if (error2) {
      console.error('Could not read migrations table:', error2.message);
    } else {
      console.table(data2);
    }
  } else {
    console.table(data);
  }
}

checkMigrations();
