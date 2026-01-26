
const siteId = 'e740358019614bcaaddd81802fa657b6';
const payload = {
    s: siteId,
    u: 'https://test.com',
    sid: '550e8400-e29b-41d4-a716-446655440000',
    sm: '2026-01-01',
    ec: 'interaction',
    ea: 'view',
    meta: { fp: 'test-fp' }
};

fetch('http://localhost:3000/api/sync', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3000'
    },
    body: JSON.stringify(payload)
})
    .then(async res => {
        const data = await res.json();
        console.log('Status:', res.status);
        console.log('Body:', JSON.stringify(data, null, 2));
    })
    .catch(err => console.error('Error:', err));
