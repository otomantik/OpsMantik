// Add name column to sites table if it doesn't exist
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ .env.local dosyasında Supabase bilgileri eksik!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function addNameColumn() {
  console.log('🔧 Sites tablosuna name kolonu ekleniyor...\n');

  try {
    // Check if column exists by trying to select it
    const { data: test, error: testError } = await supabase
      .from('sites')
      .select('name')
      .limit(1);

    if (!testError) {
      console.log('✅ name kolonu zaten mevcut!');
      return;
    }

    // Column doesn't exist, add it via SQL
    console.log('⚠️  name kolonu bulunamadı, ekleniyor...');
    
    // Use RPC to execute SQL (if available) or direct SQL
    // Note: This requires Supabase to have a function that allows SQL execution
    // Alternative: Run this SQL in Supabase Dashboard > SQL Editor
    
    console.log('\n📝 SQL Editor\'de şu komutu çalıştırın:');
    console.log('   ALTER TABLE sites ADD COLUMN IF NOT EXISTS name TEXT;');
    console.log('\nVEYA migration dosyasını uygulayın:');
    console.log('   supabase db push');

  } catch (error) {
    console.error('❌ Hata:', error.message);
  }
}

addNameColumn();
