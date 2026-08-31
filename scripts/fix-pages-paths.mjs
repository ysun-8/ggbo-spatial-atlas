import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const outputDirectory = fileURLToPath(new URL('../dist/client/', import.meta.url));
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.rsc', '.txt']);

async function rewriteDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteDirectory(path);
      continue;
    }
    if (!textExtensions.has(extname(entry.name))) continue;

    const source = await readFile(path, 'utf8');
    const rewritten = source.replace(/(?<=[('"'=])\/_next\//g, `${basePath}/_next/`);
    if (rewritten !== source) await writeFile(path, rewritten);
  }
}

if (basePath) await rewriteDirectory(outputDirectory);
