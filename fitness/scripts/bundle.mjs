// Generate standalone/shinobi-plugin-fitness.mjs — a single self-contained ESM
// file (the plugin has zero runtime deps, so bundling is just inlining the one
// local import). Drop the output into ~/.shinobi/plugins/ for a no-npm install.
//
// Run after a build:  npm run build && node scripts/bundle.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.js'))) {
  throw new Error('dist/ not found — run `npm run build` first');
}

const strip = (s) => s.replace(/^\/\/# sourceMappingURL=.*$/gm, '').trimEnd();
const rules = strip(readFileSync(join(dist, 'rules.js'), 'utf8'));
let index = strip(readFileSync(join(dist, 'index.js'), 'utf8'));
// The only runtime import is the local ./rules.js — inline it.
index = index.replace(/^import \{[\s\S]*?\} from '\.\/rules\.js';\s*$/m, '');

const header =
  '// shinobi-plugin-fitness — single-file bundle (generated from src/, zero runtime deps).\n' +
  '// Install: drop this file into ~/.shinobi/plugins/ on your Shinobi host and restart.\n' +
  '// Requires a host with registry.state (Shinobi with writable plugin state, PR #29).\n' +
  '// Regenerate with: npm run build && node scripts/bundle.mjs\n\n';

const outDir = join(root, 'standalone');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'shinobi-plugin-fitness.mjs');
writeFileSync(outFile, header + rules + '\n\n' + index + '\n');
console.log(`wrote ${outFile}`);
