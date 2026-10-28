import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
fs.mkdirSync(path.join(root,'packages/book-companion/src'),{recursive:true});
for(const file of ['isolation.mjs','store.mjs','materials.mjs'])fs.copyFileSync(path.join(root,'src',file),path.join(root,'packages/book-companion/src',file));
