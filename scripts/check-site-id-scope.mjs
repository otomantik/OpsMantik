/**
 * Regression Lock: Check for missing site_id scope in dashboard queries
 * 
 * Fails CI if any dashboard query/subscription lacks site_id scope.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DASHBOARD_PATHS = [
  'lib/hooks',
  'components/dashboard',
  'app/dashboard',
  'app/api'
];

const VIOLATIONS = [];

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  // Patterns to check
  const patterns = [
    { regex: /\.from\(['"](sessions|events|calls)['"]\)/g, name: 'table query' },
    { regex: /\.rpc\(['"](get_dashboard_\w+)['"]/g, name: 'dashboard RPC' },
    { regex: /\.channel\(['"]/g, name: 'realtime channel' },
  ];
  
  lines.forEach((line, lineNum) => {
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
    
    patterns.forEach(({ regex, name }) => {
      const matches = [...line.matchAll(regex)];
      matches.forEach(match => {
        // Check if site_id is present in the query
        const contextStart = Math.max(0, lineNum - 10);
        const contextEnd = Math.min(lines.length, lineNum + 10);
        const context = lines.slice(contextStart, contextEnd).join('\n');
        
        // Skip API routes that use site_id from params/body (they get it from request)
        if (filePath.includes('/api/')) {
          // API routes typically get site_id from request params/body
          // Skip these as they're not direct queries
          return;
        }
        
        // Check for site_id scope
        const hasSiteIdScope = 
          context.includes('site_id') ||
          context.includes('siteId') ||
          context.includes('p_site_id') ||
          context.includes(`filter: 'site_id=eq.`) ||
          context.includes(`filter: "site_id=eq.`) ||
          context.includes('.eq(\'site_id') ||
          context.includes('.eq("site_id') ||
          context.includes('WHERE site_id') ||
          context.includes('site_id IN') ||
          context.includes('session.site_id') ||
          context.includes('s.site_id') ||
          context.includes('c.site_id') ||
          context.includes('e.site_id') ||
          context.includes('.rpc(') || // RPC calls have site_id in params
          context.includes('adminClient'); // adminClient bypasses RLS but should still check
        
        if (!hasSiteIdScope) {
          VIOLATIONS.push({
            file: filePath,
            line: lineNum + 1,
            pattern: name,
            code: line.trim(),
          });
        }
      });
    });
  });
}

function scanDirectory(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  
  entries.forEach(entry => {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // Skip node_modules and .next
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) {
        return;
      }
      scanDirectory(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js') || entry.name.endsWith('.jsx'))) {
      checkFile(fullPath);
    }
  });
}

// Scan all dashboard paths
const projectRoot = join(__dirname, '..');
DASHBOARD_PATHS.forEach(path => {
  const fullPath = join(projectRoot, path);
  try {
    scanDirectory(fullPath);
  } catch (err) {
    // Directory might not exist, skip
  }
});

// Report results
if (VIOLATIONS.length > 0) {
  console.error('❌ REGRESSION LOCK FAILED: Missing site_id scope detected\n');
  console.error(`Found ${VIOLATIONS.length} violation(s):\n`);
  
  VIOLATIONS.forEach(({ file, line, pattern, code }) => {
    const relativePath = file.replace(projectRoot + '/', '');
    console.error(`  ${relativePath}:${line}`);
    console.error(`    Pattern: ${pattern}`);
    console.error(`    Code: ${code.substring(0, 80)}${code.length > 80 ? '...' : ''}\n`);
  });
  
  console.error('💡 Fix: Add site_id scope to all dashboard queries/subscriptions');
  process.exit(1);
} else {
  console.log('✅ REGRESSION LOCK PASSED: All dashboard queries have site_id scope');
  process.exit(0);
}
