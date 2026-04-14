import fetch from 'node-fetch';

const BASE_URL = 'https://console.opsmantik.com';
const API_KEY = '3a1a48f946a1f42c584dc15975ff95c2cb2cb0ab23beffc79c5bb03b0fb47726';
const PUBLIC_ID = '28cf0aefaa074f5bb29e818a9d53b488';

async function test() {
  console.log('--- Handshake ---');
  const vRes = await fetch(`${BASE_URL}/api/oci/v2/verify`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: PUBLIC_ID })
  });
  
  const vData = await vRes.json();
  console.log('Verify Status:', vRes.status);
  console.log('Verify Data:', vData);
  
  if (!vData.session_token) return;
  
  console.log('\n--- Export ---');
  const eRes = await fetch(`${BASE_URL}/api/oci/google-ads-export?siteId=${PUBLIC_ID}&markAsExported=false`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${vData.session_token}` }
  });
  
  const eData = await eRes.json();
  console.log('Export Status:', eRes.status);
  console.log('Export Items Count:', Array.isArray(eData) ? eData.length : (eData.items ? eData.items.length : 'N/A'));
  console.log('Full Response Scope:', JSON.stringify(eData, null, 2).substring(0, 1000));
}

test();
