'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const locales = ['en', 'zh-CN'];
const files = ['common.json', 'sidebar.json', 'statusbar.json', 'commands.json', 'settings.json'];

const placeholders = value => [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]).sort();
const load = locale => Object.assign({}, ...files.map(file => JSON.parse(fs.readFileSync(path.join(root, 'l10n', locale, file), 'utf8'))));

const catalogs = Object.fromEntries(locales.map(locale => [locale, load(locale)]));
const sourceKeys = Object.keys(catalogs.en).sort();
const failures = [];

for (const locale of locales.slice(1)) {
  const targetKeys = Object.keys(catalogs[locale]).sort();
  const missing = sourceKeys.filter(key => !targetKeys.includes(key));
  const extra = targetKeys.filter(key => !sourceKeys.includes(key));
  if (missing.length) failures.push(`${locale} missing: ${missing.join(', ')}`);
  if (extra.length) failures.push(`${locale} extra: ${extra.join(', ')}`);
  for (const key of sourceKeys) {
    if (JSON.stringify(placeholders(catalogs.en[key])) !== JSON.stringify(placeholders(catalogs[locale][key] || ''))) {
      failures.push(`${locale} placeholder mismatch: ${key}`);
    }
  }
}

for (const locale of locales) {
  for (const [key, value] of Object.entries(catalogs[locale])) {
    if (typeof value !== 'string' || value.trim() === '') failures.push(`${locale} empty value: ${key}`);
  }
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Locale catalogs verified: ${sourceKeys.length} keys across ${locales.length} locales.\n`);
}
