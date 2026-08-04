'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const includedRoots = ['src', 'test', 'l10n', 'resources'];
const allowedExtensions = new Set(['.ts', '.js', '.json', '.html', '.css', '.svg']);
const suspicious = [
  /https?:\/\/[^\s'"<>]+\?(?:[^\s'"<>]*&)?(?:token|secret|key)=[A-Za-z0-9_-]{12,}/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\b(?:token|secret|password)\s*[:=]\s*['"][A-Za-z0-9._~+\/-]{20,}['"]/gi
];

const files = [];
const walk = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(resolved);
    else if (allowedExtensions.has(path.extname(entry.name))) files.push(resolved);
  }
};
for (const directory of includedRoots) walk(path.join(root, directory));

const failures = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of suspicious) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) failures.push(path.relative(root, file));
  }
}

if (failures.length) {
  process.stderr.write(`Potential secrets found in:\n${[...new Set(failures)].join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Secret scan passed for ${files.length} source assets.\n`);
}
