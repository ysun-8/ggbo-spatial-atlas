// The gGBO repository owns the shared viewer. Primary data stay in their own repository.
// Run from the gGBO repository: node scripts/sync-primary-site.mjs ../primary-gbm-spatial-atlas
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const target = path.resolve(process.argv[2] ?? '../primary-gbm-spatial-atlas');
if (target === process.cwd()) throw new Error('Choose a separate primary repository');
// Remove obsolete shared scaffold files, while leaving data and other local files alone.
for (const directory of ['components/ui', 'hooks', '.openai']) {
  const destination = path.join(target, directory);
  if (!fs.existsSync(destination)) continue;
  for (const file of fs.readdirSync(destination)) {
    if (!fs.existsSync(path.join(directory, file)) && fs.statSync(path.join(destination, file)).isFile()) fs.unlinkSync(path.join(destination, file));
  }
}
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of new Set(files)) {
  if (file.startsWith('public/') || file === 'atlas/catalog.json' || !fs.existsSync(file)) continue;
  const destination = path.join(target, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
}
fs.mkdirSync(path.join(target, 'atlas'), { recursive: true });
fs.copyFileSync('atlas/primary-catalog.json', path.join(target, 'atlas/catalog.json'));
if (fs.existsSync('public/about.html')) fs.copyFileSync('public/about.html', path.join(target, 'public/about.html'));
console.log(`Shared viewer updated in ${target}; primary data were not changed.`);
