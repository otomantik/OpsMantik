// Veritabanı durumunu kontrol etmek için script
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ .env.local dosyasında Supabase bilgileri eksik!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDatabase() {
  console.log('🔍 Veritabanı durumu kontrol ediliyor...\n');

  try {
    // 1. Sites tablosu kontrolü
    const { data: sites, error: sitesError } = await supabase
      .from('sites')
      .select('*')
      .limit(5);

    if (sitesError) {
      if (sitesError.code === 'PGRST116') {
        console.log('⚠️  sites tablosu bulunamadı - Migration gerekli!');
      } else {
        console.log('❌ sites tablosu hatası:', sitesError.message);
      }
    } else {
      console.log(`✅ sites tablosu mevcut - ${sites?.length || 0} kayıt`);
    }

    // 2. Sessions tablosu kontrolü
    const { data: sessions, error: sessionsError } = await supabase
      .from('sessions')
      .select('*')
      .limit(5);

    if (sessionsError) {
      if (sessionsError.code === 'PGRST116') {
        console.log('⚠️  sessions tablosu bulunamadı - Migration gerekli!');
      } else {
        console.log('❌ sessions tablosu hatası:', sessionsError.message);
      }
    } else {
      console.log(`✅ sessions tablosu mevcut - ${sessions?.length || 0} kayıt`);
    }

    // 3. Events tablosu kontrolü
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('*')
      .limit(5);

    if (eventsError) {
      if (eventsError.code === 'PGRST116') {
        console.log('⚠️  events tablosu bulunamadı - Migration gerekli!');
      } else {
        console.log('❌ events tablosu hatası:', eventsError.message);
      }
    } else {
      console.log(`✅ events tablosu mevcut - ${events?.length || 0} kayıt`);
    }

    // 4. Calls tablosu kontrolü
    const { data: calls, error: callsError } = await supabase
      .from('calls')
      .select('*')
      .limit(5);

    if (callsError) {
      if (callsError.code === 'PGRST116') {
        console.log('⚠️  calls tablosu bulunamadı - Migration gerekli!');
      } else {
        console.log('❌ calls tablosu hatası:', callsError.message);
      }
    } else {
      console.log(`✅ calls tablosu mevcut - ${calls?.length || 0} kayıt`);
    }

    console.log('\n📊 Özet:');
    console.log('   - Veritabanı bağlantısı: ✅');
    console.log('   - Tablolar kontrol edildi');
    console.log('\n💡 Eğer tablolar yoksa, migration uygulayın:');
    console.log('   supabase db push');

  } catch (error) {
    console.error('❌ Hata:', error.message);
  }
}

checkDatabase();
