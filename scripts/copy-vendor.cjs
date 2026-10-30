const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '..', 'node_modules', '@dagrejs', 'dagre', 'dist', 'dagre.min.js');
const destDir = path.resolve(__dirname, '..', 'media', 'vendor');
const dest = path.join(destDir, 'dagre.min.js');

if (!fs.existsSync(source)) {
  process.stderr.write(`copy-vendor: ${source} not found. Run "npm install" first.\n`);
  process.exitCode = 1;
} else {
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(source, dest);
  process.stdout.write(`copy-vendor: wrote ${path.relative(path.resolve(__dirname, '..'), dest)}\n`);
}
