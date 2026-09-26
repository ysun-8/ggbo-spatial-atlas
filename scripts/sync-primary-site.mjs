// The gGBO repository owns the shared viewer. Primary data stay in their own repository.
// Run from the gGBO repository: node scripts/sync-primary-site.mjs ../primary-gbm-spatial-atlas
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const target = path.resolve(process.argv[2] ?? '../primary-gbm-spatial-atlas');
if (target === process.cwd()) throw new Error('Choose a separate primary repository');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of new Set(files)) {
  if (file.startsWith('public/') || file === 'atlas/catalog.json' || !fs.existsSync(file)) continue;
  const destination = path.join(target, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
}
fs.mkdirSync(path.join(target, 'atlas'), { recursive: true });
fs.copyFileSync('atlas/primary-catalog.json', path.join(target, 'atlas/catalog.json'));
console.log(`Shared viewer updated in ${target}; primary data were not changed.`);
