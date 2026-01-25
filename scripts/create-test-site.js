// Create test site for development
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ .env.local dosyasında Supabase bilgileri eksik!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createTestSite() {
  console.log('🔧 Test site oluşturuluyor...\n');

  try {
    // First, get or create a test user
    // Note: In production, users sign up via OAuth
    // For testing, we'll create a site with a dummy user_id
    // You'll need to replace this with your actual user_id from auth.users

    const testPublicId = 'test_site_123';
    const testDomain = 'localhost:3000';

    // Check if site already exists
    const { data: existingSite } = await supabase
      .from('sites')
      .select('*')
      .eq('public_id', testPublicId)
      .maybeSingle();

    if (existingSite) {
      console.log('✅ Test site zaten mevcut:');
      console.log(`   ID: ${existingSite.id}`);
      console.log(`   Public ID: ${existingSite.public_id}`);
      console.log(`   User ID: ${existingSite.user_id}`);
      return;
    }

    // Get first user from auth (for testing)
    // In production, this would be the authenticated user
    const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();

    if (usersError || !users || users.length === 0) {
      console.error('❌ Kullanıcı bulunamadı!');
      console.error('   Önce Supabase Dashboard\'dan bir kullanıcı oluşturun veya OAuth ile giriş yapın.');
      console.error('   Sonra bu script\'i tekrar çalıştırın.');
      return;
    }

    const testUserId = users[0].id;
    console.log(`📝 Kullanıcı bulundu: ${testUserId}`);

    // Create test site
    // Note: Only include columns that exist in the current schema
    const { data: newSite, error: createError } = await supabase
      .from('sites')
      .insert({
        user_id: testUserId,
        public_id: testPublicId,
        domain: testDomain,
      })
      .select()
      .single();

    if (createError) {
      console.error('❌ Site oluşturma hatası:', createError.message);
      console.error('   Code:', createError.code);
      console.error('   Details:', createError.details);
      return;
    }

    console.log('✅ Test site oluşturuldu:');
    console.log(`   ID: ${newSite.id}`);
    console.log(`   Public ID: ${newSite.public_id}`);
    console.log(`   Domain: ${newSite.domain || 'N/A'}`);
    if (newSite.name) {
      console.log(`   Name: ${newSite.name}`);
    }
    console.log('\n🎉 Artık test-page\'de tracker script\'i çalışacak!');
    console.log('   Test URL: http://localhost:3000/test-page?gclid=TEST_GCLID_X99_AB');

  } catch (error) {
    console.error('❌ Hata:', error.message);
  }
}

createTestSite();
