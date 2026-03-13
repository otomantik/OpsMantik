
import fetch from 'node-fetch';

const API_KEY = '3a1a48f946a1f42c584dc15975ff95c2cb2cb0ab23beffc79c5bb03b0fb47726';
const SITE_ID = '28cf0aefaa074f5bb29e818a9d53b488';
const BASE_URL = 'http://localhost:3000';

async function testSealV3() {
  console.log('--- Testing V3 (Görüşüldü) Signal ---');
  
  // We need a valid call ID from the DB. 
  // Let's assume we have one from previous logs or we can try to find one.
  // For testing purposes, I'll use a known existing call ID if possible.
  const callId = '36713837-143f-4e19-9524-811c05d7b5bf'; 

  const res = await fetch(`${BASE_URL}/api/calls/${callId}/seal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`, // Using API Key path
      'x-api-key': API_KEY
    },
    body: JSON.stringify({
      lead_score: 60, // V3
      version: 0,
      currency: 'TRY'
    })
  });

  const data = await res.json();
  console.log('Response:', JSON.stringify(data, null, 2));
}

testSealV3();
