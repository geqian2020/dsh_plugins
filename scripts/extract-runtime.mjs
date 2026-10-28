import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const source = process.env.DSH_ASAR ?? path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness/resources/app.asar');
const fd = fs.openSync(source, 'r');
try {
  const header = Buffer.alloc(16); fs.readSync(fd, header, 0, 16, 0);
  const size = header.readUInt32LE(12), base = 8 + header.readUInt32LE(4);
  const bytes = Buffer.alloc(size); fs.readSync(fd, bytes, 0, size, 16);
  const tree = JSON.parse(bytes), target = path.join(root, 'vendor/installed-runtime');
  let count = 0;
  function walk(node, prefix = '') {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (entry.files) { walk(entry, relative); continue; }
      if (!relative.startsWith('dsh/') || entry.link) continue;
      const out = path.resolve(target, relative.slice(4));
      if (!out.startsWith(target + path.sep)) throw new Error('Invalid archive path');
      const data = entry.unpacked ? fs.readFileSync(source + '.unpacked/' + relative) : Buffer.alloc(entry.size);
      if (!entry.unpacked) fs.readSync(fd, data, 0, data.length, base + Number(entry.offset));
      fs.mkdirSync(path.dirname(out), {recursive:true}); fs.writeFileSync(out,data); count++;
    }
  }
  walk(tree);
  fs.mkdirSync(path.join(root,'artifacts'), {recursive:true});
  fs.writeFileSync(path.join(root,'artifacts/runtime-snapshot.json'),JSON.stringify({source,headerSha256:crypto.createHash('sha256').update(bytes).digest('hex'),files:count},null,2));
  console.log(`Extracted ${count} runtime files (read-only source) to ${target}`);
} finally { fs.closeSync(fd); }
