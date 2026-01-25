#!/usr/bin/env node
/**
 * WAR ROOM Regression Lock Check
 * 
 * Checks for critical violations:
 * 1. No next/font/google in app/ or components/
 * 2. No SUPABASE_SERVICE_ROLE_KEY in app/ or components/
 * 
 * Cross-platform (Windows/Mac/Linux)
 */

const fs = require('fs');
const path = require('path');

const VIOLATIONS = [];

// Directories to check (client-side code)
const CLIENT_DIRS = ['app', 'components'];

// Patterns to check
const FORBIDDEN_PATTERNS = [
  {
    pattern: /next\/font\/google/,
    name: 'next/font/google',
    message: 'next/font/google is forbidden in client code (adds build-time dependency)'
  },
  {
    pattern: /SUPABASE_SERVICE_ROLE_KEY/,
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    message: 'SUPABASE_SERVICE_ROLE_KEY must not appear in client code (security risk)',
    // Exception: allow in lib/supabase/admin.ts (server-side only)
    exception: (filePath) => filePath.includes('lib/supabase/admin.ts')
  }
];

// File extensions to check
const CHECK_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Recursively walk directory and find files
 */
function walkDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip node_modules and .next
      if (file === 'node_modules' || file === '.next' || file === '.git') {
        return;
      }
      walkDir(filePath, fileList);
    } else {
      const ext = path.extname(file);
      if (CHECK_EXTENSIONS.includes(ext)) {
        filePath.replace(/\\/g, '/'); // Normalize path separators
        fileList.push(filePath);
      }
    }
  });
  
  return fileList;
}

/**
 * Check file for violations
 */
function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  FORBIDDEN_PATTERNS.forEach(({ pattern, name, message, exception }) => {
    // Check exception
    if (exception && exception(filePath)) {
      return; // Skip this file
    }
    
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        VIOLATIONS.push({
          file: filePath,
          line: index + 1,
          pattern: name,
          message: message,
          content: line.trim()
        });
      }
    });
  });
}

// Main execution
function main() {
  console.log('🔒 WAR ROOM Regression Lock Check\n');
  
  // Check each client directory
  CLIENT_DIRS.forEach(dir => {
    const dirPath = path.join(process.cwd(), dir);
    
    if (!fs.existsSync(dirPath)) {
      console.log(`⚠️  Directory not found: ${dir}`);
      return;
    }
    
    console.log(`📁 Checking ${dir}/...`);
    const files = walkDir(dirPath);
    
    files.forEach(file => {
      checkFile(file);
    });
  });
  
  // Report results
  if (VIOLATIONS.length === 0) {
    console.log('\n✅ No violations found. WAR ROOM lock is secure.\n');
    process.exit(0);
  } else {
    console.log(`\n❌ Found ${VIOLATIONS.length} violation(s):\n`);
    
    VIOLATIONS.forEach((violation, index) => {
      console.log(`${index + 1}. ${violation.pattern}`);
      console.log(`   File: ${violation.file}`);
      console.log(`   Line: ${violation.line}`);
      console.log(`   ${violation.message}`);
      console.log(`   Content: ${violation.content}`);
      console.log('');
    });
    
    console.log('🚨 WAR ROOM regression lock FAILED. Fix violations before committing.\n');
    process.exit(1);
  }
}

// Run check
main();
