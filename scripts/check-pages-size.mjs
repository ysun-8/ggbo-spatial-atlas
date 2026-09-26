import fs from 'node:fs';
import path from 'node:path';
function size(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, item) => {
    const file = path.join(directory, item.name);
    return total + (item.isDirectory() ? size(file) : fs.statSync(file).size);
  }, 0);
}
const bytes = size('dist/client');
console.log(`Published site: ${bytes.toLocaleString()} bytes`);
if (bytes >= 1_000_000_000) throw new Error('Site exceeds the GitHub Pages 1 GB limit');
