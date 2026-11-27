// Build standalone/shinobi-plugin-fitness.mjs — one self-contained ESM file
// (zero runtime dependencies) for Shinobi's dashboard catalog and for
// dropping into ~/.shinobi/plugins/ without npm.
//
//   npm run bundle
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'standalone', 'shinobi-plugin-fitness.mjs');

await build({
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  legalComments: 'none',
  banner: {
    js:
      '// shinobi-plugin-fitness — "The System". Single-file bundle generated from src/ (npm run bundle).\n' +
      '// Install from the Shinobi dashboard (Plugins → Catalog) or drop this file into ~/.shinobi/plugins/.\n' +
      '// Needs Shinobi 0.13+ for the full page (figures, forms, theme); tools work on any host with registry.state.',
  },
});
console.log(`wrote ${outfile}`);
