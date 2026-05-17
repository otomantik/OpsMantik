
import fs from 'fs';

function searchSchema() {
  const filePath = './schema.sql';
  const content = fs.readFileSync(filePath, 'utf8'); // Try utf8 first
  const lines = content.split('\n');
  
  const keywords = ['gclid', 'click_id', 'utm_term', 'google_ads'];
  console.log(`Searching ${lines.length} lines for: ${keywords.join(', ')}...`);

  let currentTable = '';
  lines.forEach((line, i) => {
    // Detect table definition
    const tableMatch = line.match(/CREATE TABLE\s+(?:public\.)?(\w+)/i);
    if (tableMatch) currentTable = tableMatch[1];

    const lowerLine = line.toLowerCase();
    keywords.forEach(kw => {
      if (lowerLine.includes(kw)) {
        console.log(`L${i+1} [Table: ${currentTable}]: ${line.trim()}`);
      }
    });
  });
}

searchSchema();
