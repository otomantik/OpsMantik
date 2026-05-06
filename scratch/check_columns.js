const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function checkColumns() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
  });
  await client.connect();
  try {
    const res = await client.query(`
      SELECT table_name, column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name IN ('conversations', 'conversation_links', 'sales', 'calls')
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } finally {
    await client.end();
  }
}

checkColumns().catch(console.error);
