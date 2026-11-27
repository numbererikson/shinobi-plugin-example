// Dev helper: write preview/index.html with every exercise figure, live and
// as frozen snapshots across its loop, to eyeball poses while editing.
//   npm run preview   → open fitness/preview/index.html (gitignored)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXERCISES } from '../dist/exercises.js';
import { renderFigure } from '../dist/figure.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const only = process.argv.slice(2);
const SNAPS = [0, 0.2, 0.4, 0.6, 0.8];

const rows = EXERCISES.filter((e) => only.length === 0 || only.includes(e.id)).map((e) => {
  const svg = renderFigure(e.figure, e.name);
  const snaps = SNAPS.map((f) => `<div class="cell" data-f="${f}">${svg}</div>`).join('');
  return `<section><h2>${e.id} — ${e.name}</h2><div class="row">${snaps}</div></section>`;
});

const html = `<!doctype html><meta charset="utf-8"><title>figures</title>
<style>
body{background:#050a16;color:#e3f2ff;font:13px system-ui;margin:12px}
h2{font-size:13px;margin:10px 0 4px;color:#4fd8ff}
.row{display:flex;gap:6px}.cell{background:#0a1428;border:1px solid #1d3b6b}
svg{width:150px;height:150px;display:block}
</style>
${rows.join('\n')}
<script>
for (const cell of document.querySelectorAll('.cell')) {
  const svg = cell.querySelector('svg');
  const anim = svg.querySelector('animate');
  const dur = anim ? parseFloat(anim.getAttribute('dur')) : 1;
  svg.pauseAnimations();
  svg.setCurrentTime(dur * parseFloat(cell.dataset.f));
}
</script>`;

mkdirSync(join(root, 'preview'), { recursive: true });
writeFileSync(join(root, 'preview', 'index.html'), html);
console.log(`wrote preview/index.html (${rows.length} exercises)`);
