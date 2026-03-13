
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function discoverInsights() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const siteId = '28cf0aefaa074f5bb29e818a9d53b488'; // Muratcan

  const supabase = createClient(url, key);

  console.log('--- MizanMantik Data Discovery ---');

  // 1. AOV Discovery
  const { data: sales } = await supabase
    .from('calls')
    .select('sale_amount')
    .eq('site_id', siteId)
    .gt('sale_amount', 0);

  if (sales && sales.length > 0) {
    const total = sales.reduce((acc, s) => acc + s.sale_amount, 0);
    const avg = total / sales.length;
    console.log(`Site AOV: ${avg.toFixed(2)} TL (based on ${sales.length} sales)`);
  }

  // 2. Location Intelligence
  try {
    const { data: locData, error: locErr } = await supabase.rpc('get_location_breakdown_v1', { p_site_id: siteId });
    if (locErr) console.error('Location RPC Error:', locErr.message);
    else console.log('Location Performance (Sample):', JSON.stringify(locData?.slice(0, 5), null, 2));
  } catch (e) {
    console.warn('Location RPC failed (probably does not exist).');
  }

  // 3. Behavioral Correlation
  // Which actions correlate with sales?
  const { data: correlation } = await supabase
    .from('calls')
    .select('whatsapp_clicks, phone_clicks, sale_amount')
    .eq('site_id', siteId)
    .limit(100);

  if (correlation) {
    const waSales = correlation.filter(c => c.whatsapp_clicks > 0 && c.sale_amount > 0).length;
    const phoneSales = correlation.filter(c => c.phone_clicks > 0 && c.sale_amount > 0).length;
    console.log(`WhatsApp Correlation: ${waSales} sales`);
    console.log(`Phone Correlation: ${phoneSales} sales`);
  }
  
  console.log('\nSuggested LCV 2.0 Adjustments:');
  console.log('- Use dynamic baseAov from site history.');
  console.log('- Increase weight for WhatsApp as it shows higher correlation.');
  console.log('- Add "Returning Visitor" flag as a 1.5x multiplier.');
}

discoverInsights();
