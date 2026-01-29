// File: scripts/find-zombies.mjs
// 👻 GHOSTBUSTER: Finds zombie/dead code by scanning for legacy keywords.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 🧟 ARANACAK ZOMBİ KELİMELER (Burayı güncelleyebilirsin)
const ZOMBIE_KEYWORDS = [
  'call_alert',      // Eski call alert
  'callAlert',       // CamelCase versiyonu
  'panel_v1',        // Eski panel?
  'dashboard-old',   // Eski klasörler?
  'legacy',          // Genelde eskiler böyle etiketlenir
  'deprecated',      // Kullanımdan kalkanlar
  'old_system'
];

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = ['node_modules', '.next', '.git', 'dist', 'build'];

console.log('👻 GHOSTBUSTER PROTOCOL INITIATED...');
console.log(`🔎 Hunting for: ${ZOMBIE_KEYWORDS.join(', ')}\n`);

function scanDir(dir) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (!SKIP_DIRS.includes(file)) scanDir(fullPath);
    } else {
      checkFile(fullPath);
    }
  });
}

function checkFile(filePath) {
  try {
    const relativePath = path.relative(ROOT_DIR, filePath);
    // Script kendini raporlamasın
    if (relativePath.replace(/\\/g, '/').endsWith('find-zombies.mjs')) return;

    const content = fs.readFileSync(filePath, 'utf-8');

    ZOMBIE_KEYWORDS.forEach(keyword => {
      if (content.includes(keyword)) {
        // Migration dosyalarını hariç tutabiliriz, tarihçe için kalabilirler
        if (!relativePath.includes('migrations')) {
          console.log(`🧟 FOUND [${keyword}] in: ${relativePath}`);
        }
      }
    });

    // Klasör isminde geçiyor mu?
    if (filePath.includes('call_alert') || filePath.includes('old_')) {
      console.log(`📂 ZOMBIE FILE/FOLDER: ${path.relative(ROOT_DIR, filePath)}`);
    }
  } catch (e) {
    // Binary dosyaları okuyamazsa geç
  }
}

scanDir(ROOT_DIR);
console.log('\n✅ Scan complete. If the list is empty, you are clean.');
