#!/usr/bin/env node
/**
 * Sync utility for Pharma POS - Local ↔ Web
 * 
 * Usage:
 *   node sync.js --export > backup.json          # Export all data
 *   node sync.js --import backup.json            # Import data
 *   node sync.js --to-web https://your-app.com   # Push local to web
 *   node sync.js --from-web https://your-app.com # Pull web to local
 */

import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'pharma.db');

const TABLES = [
  'products', 'customers', 'sales', 'sales_items', 'purchases', 'purchase_items',
  'payments', 'suppliers', 'debts', 'users', 'cash_register', 'inventory_adjustments',
  'audit_logs', 'auth_users', 'auth_sessions', 'company_accounts', 'customer_accounts',
  'company_account_payments', 'customer_account_payments', 'till_sessions',
  'settings', 'offline_actions'
];

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

async function exportData() {
  const data = {};
  const meta = {
    exported_at: new Date().toISOString(),
    version: '1.0.0'
  };
  
  for (const table of TABLES) {
    try {
      data[table] = await allQuery(`SELECT * FROM ${table}`);
      console.error(`Exported ${table}: ${data[table].length} rows`);
    } catch (e) {
      console.error(`Skipped ${table}: ${e.message}`);
    }
  }
  
  return { meta, data };
}

async function importData(data, dryRun = false) {
  const writeDb = new sqlite3.Database(DB_PATH);
  
  return new Promise((resolve, reject) => {
    writeDb.serialize(() => {
      writeDb.run('BEGIN TRANSACTION');
      
      for (const [table, rows] of Object.entries(data)) {
        if (!TABLES.includes(table) || !Array.isArray(rows)) continue;
        
        // Clear existing data
        writeDb.run(`DELETE FROM ${table}`);
        
        if (rows.length === 0) continue;
        
        // Get columns from first row
        const columns = Object.keys(rows[0]);
        const placeholders = columns.map(() => '?').join(',');
        const stmt = writeDb.prepare(
          `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`
        );
        
        for (const row of rows) {
          const values = columns.map(col => row[col] ?? null);
          stmt.run(values);
        }
        stmt.finalize();
        console.error(`Imported ${table}: ${rows.length} rows`);
      }
      
      if (dryRun) {
        writeDb.run('ROLLBACK', () => {
          console.error('DRY RUN - rolled back');
          resolve();
        });
      } else {
        writeDb.run('COMMIT', () => {
          console.error('Committed to database');
          resolve();
        });
      }
    });
  });
}

async function syncToWeb(webUrl) {
  const data = await exportData();
  const response = await fetch(`${webUrl}/api/sync/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data.data)
  });
  
  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status}`);
  }
  
  const result = await response.json();
  console.log('Sync to web complete:', result);
}

async function syncFromWeb(webUrl) {
  const response = await fetch(`${webUrl}/api/sync/export`);
  const { data } = await response.json();
  await importData(data);
  console.log('Sync from web complete');
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--help') || args.length === 0) {
  console.log(`
Sync Utility for Pharma POS

Usage:
  node sync.js --export [file.json]     Export database to JSON
  node sync.js --import file.json       Import JSON to database  
  node sync.js --to-web URL             Push local data to web
  node sync.js --from-web URL           Pull web data to local
  node sync.js --dry-run                Test import without writing

Examples:
  node sync.js --export > backup.json
  node sync.js --export backup.json
  node sync.js --to-web https://pharma-pos.onrender.com
  node sync.js --import backup.json --dry-run
`);
  process.exit(0);
}

const dryRun = args.includes('--dry-run');

if (args.includes('--export')) {
  const fileIndex = args.indexOf('--export') + 1;
  const outputFile = args[fileIndex] && !args[fileIndex].startsWith('--') ? args[fileIndex] : null;
  
  const data = await exportData();
  const json = JSON.stringify(data, null, 2);
  
  if (outputFile) {
    fs.writeFileSync(outputFile, json);
    console.error(`Exported to ${outputFile}`);
  } else {
    console.log(json);
  }
  process.exit(0);
}

if (args.includes('--import')) {
  const fileIndex = args.indexOf('--import') + 1;
  const inputFile = args[fileIndex];
  
  if (!inputFile || !fs.existsSync(inputFile)) {
    console.error('Error: Provide valid JSON file path');
    process.exit(1);
  }
  
  const { data } = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  await importData(data, dryRun);
  console.log(dryRun ? 'Dry run complete' : 'Import complete');
  process.exit(0);
}

if (args.includes('--to-web')) {
  const urlIndex = args.indexOf('--to-web') + 1;
  const webUrl = args[urlIndex];
  
  if (!webUrl) {
    console.error('Error: Provide web URL');
    process.exit(1);
  }
  
  await syncToWeb(webUrl);
  process.exit(0);
}

if (args.includes('--from-web')) {
  const urlIndex = args.indexOf('--from-web') + 1;
  const webUrl = args[urlUrl];
  
  if (!webUrl) {
    console.error('Error: Provide web URL');
    process.exit(1);
  }
  
  await syncFromWeb(webUrl);
  process.exit(0);
}
