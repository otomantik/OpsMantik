
import { isOriginAllowed } from './lib/cors.js';

const allowedOrigins = [
    'https://www.sosreklam.com',
    'https://sosreklam.com',
    'https://www.poyrazantika.com',
    'https://poyrazantika.com',
    'https://console.opsmantik.com'
];

const testOrigins = [
    'https://www.sosreklam.com',
    'https://sosreklam.com',
    'https://www.poyrazantika.com',
    'https://poyrazantika.com'
];

console.log('Testing CORS logic:');
testOrigins.forEach(origin => {
    const allowed = isOriginAllowed(origin, allowedOrigins);
    console.log(`${origin} -> ${allowed ? '✅ ALLOWED' : '❌ BLOCKED'}`);
});

const allowedOriginsShort = ['sosreklam.com', 'poyrazantika.com'];
console.log('\nTesting with short domains (no protocol):');
testOrigins.forEach(origin => {
    const allowed = isOriginAllowed(origin, allowedOriginsShort);
    console.log(`${origin} -> ${allowed ? '✅ ALLOWED' : '❌ BLOCKED'}`);
});
