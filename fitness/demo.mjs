// Live demo of @shinobi/plugin-fitness against the compiled dist.
// Uses a tiny in-memory fake of registry.state (the real host uses SQLite).
import register from './dist/index.js';

function makeStore(b){return{get(k){const r=b.get(k);if(r===undefined)return null;try{return JSON.parse(r)}catch{return null}},set(k,v){b.set(k,JSON.stringify(v))},delete(k){b.delete(k)},update(k,m){const r=b.get(k);let c=null;if(r!==undefined){try{c=JSON.parse(r)}catch{c=null}}const n=m(c);b.set(k,JSON.stringify(n));return n}}}
function mount(b=new Map()){const tools=new Map();register({registerTool:d=>tools.set(d.name,d),state:makeStore(b)});return async(n,a={})=>tools.get(n).handler(a)}

const call = mount();
const show = (label, v) => console.log(`\n▶ ${label}\n` + JSON.stringify(v, null, 2));

console.log('=== @shinobi/plugin-fitness — live demo ===');

show('plugin_fitness_create (180-day mission, smoke/alcohol-free, old shoulder)', await call('plugin_fitness_create', {
  goal:'visible_abs', smokeFreeSince:'2026-06-01', alcoholFreeSince:'2026-06-01',
  restrictions:{ shoulder:{ side:'right', status:'watch', lastPain:2 } },
}));

show('plugin_fitness_today (day 1 — safe foundation workout)', await call('plugin_fitness_today'));

show('plugin_fitness_log_pain (right shoulder 5/10 → escalates to avoid)', await call('plugin_fitness_log_pain', { area:'shoulder', side:'right', value:5 }));

show('plugin_fitness_today (now swaps push day for legs/core)', await call('plugin_fitness_today'));

show('plugin_fitness_set_equipment (bench + dumbbells → unlocks phase2)', await call('plugin_fitness_set_equipment', { level:'bench_dumbbells' }));

show('plugin_fitness_log_weight (82.5 kg)', await call('plugin_fitness_log_weight', { weightKg:82.5 }));

show('plugin_fitness_status (full summary)', await call('plugin_fitness_status'));

console.log('\n=== done — all 7 tools exercised, structured facts only (no coaching text) ===');
