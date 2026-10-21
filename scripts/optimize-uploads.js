#!/usr/bin/env node
// Reduz as imagens já enviadas (fotos de 2-4 MB tiradas do celular) mantendo nome e formato,
// para não precisar mexer nas URLs gravadas no banco. Também remove metadados (EXIF/GPS).
// Faça backup antes. Na VPS:
//   docker exec eplenarius_api node scripts/optimize-uploads.js --dry-run
//   docker exec eplenarius_api node scripts/optimize-uploads.js

const { readdirSync, statSync } = require('fs');
const { join } = require('path');
const { optimizeImage } = require('../dist/common/image-optimizer');

const dir = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
const dry = process.argv.includes('--dry-run');
const MIN_BYTES = 250 * 1024;

async function main() {
  let before = 0, after = 0;
  for (const name of readdirSync(dir)) {
    if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;
    const path = join(dir, name);
    const size = statSync(path).size;
    if (size < MIN_BYTES) continue;
    const kind = name.startsWith('avatar_') ? 'avatar' : 'logo';
    if (dry) {
      console.log(`[simulação] ${name} (${kind}) ${(size / 1024).toFixed(0)} KB`);
      continue;
    }
    try {
      const r = await optimizeImage(path, kind, { keepFormat: true });
      before += r.before; after += r.after;
      console.log(`${name} (${kind}) ${(r.before / 1024).toFixed(0)} KB -> ${(r.after / 1024).toFixed(0)} KB`);
    } catch (e) {
      console.error(`${name}: ${e.message} (mantido como estava)`);
    }
  }
  if (!dry) console.log(`Total: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
