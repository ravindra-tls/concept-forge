// Refresh knowledge/ad-templates.json from TAE Ad Studio's prompt_templates table.
// Zero-dependency (raw Supabase REST via built-in fetch). Reads the Supabase URL +
// service key from TAE's .env.local at runtime; never prints or stores the secret.
//
//   node scripts/snapshot-templates.mjs
//
// Override the source env file with TAE_ENV_FILE=... if TAE lives elsewhere.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = process.env.TAE_ENV_FILE
  || 'C:/Users/ravindra.singh/Claude assets/tae-ad-studio/.env.local';
const OUT_PATH = path.join(__dirname, '..', 'knowledge', 'ad-templates.json');

const env = {};
for (const l of fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase URL or service key in', ENV_PATH); process.exit(1); }

const endpoint = `${url}/rest/v1/prompt_templates?select=number,name,category,template,default_aspect_ratio,preview_image_url&order=number.asc`;
const res = await fetch(endpoint, { headers: { apikey: key, authorization: `Bearer ${key}` } });
if (!res.ok) { console.error(`Supabase REST error ${res.status}: ${await res.text()}`); process.exit(1); }
const rows = await res.json();

const templates = rows.map((r) => ({
  number: r.number,
  name: r.name,
  category: r.category,
  aspect_ratio: r.default_aspect_ratio,
  preview_image_url: r.preview_image_url || null,
  template: r.template,
}));

fs.writeFileSync(OUT_PATH, JSON.stringify({ snapshotAt: new Date().toISOString(), count: templates.length, templates }, null, 2));
const cats = {};
templates.forEach((t) => { cats[t.category] = (cats[t.category] || 0) + 1; });
console.log(`Wrote ${templates.length} templates → ${path.relative(process.cwd(), OUT_PATH)}`);
console.log('By category:', JSON.stringify(cats));
