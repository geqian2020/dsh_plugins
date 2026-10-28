import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const source=process.env.OPENVIKING_SOURCE??path.join(process.env.USERPROFILE,'.dsh/profiles/desktop/node_modules/@openviking/dsh-memory-plugin');
const dest=path.join(root,'packages/openviking-memory-isolated');
const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json')));
if(pkg.version!=='0.5.20')throw new Error('Expected OpenViking 0.5.20; review patch against new version');
fs.mkdirSync(dest,{recursive:true});
for(const entry of fs.readdirSync(source,{withFileTypes:true})) {
  if(entry.name==='node_modules')continue;
  fs.cpSync(path.join(source,entry.name),path.join(dest,entry.name),{recursive:true});
}
const file=path.join(dest,'index.mjs');let text=fs.readFileSync(file,'utf8');
const originalHash=crypto.createHash('sha256').update(text).digest('hex');
const before='  const skipMemory = session => (\n    config.skipSubagentSessions && session?.header?.origin === "subagent"\n  );';
if(!text.includes(before))throw new Error('Upstream lifecycle changed; patch refused');
text='import { createPolicy, memoryToolGuard, assertManagedIdentity } from "./isolation.mjs";\n'+text.replace(before,'  const excluded = createPolicy(input);\n  const skipMemory = session => excluded(session) || (\n    config.skipSubagentSessions && session?.header?.origin === "subagent"\n  );\n  if (typeof ctx.tools.guard !== "function") throw new Error("Memory isolation requires tools.guard");\n  ctx.tools.guard(memoryToolGuard(excluded));');
text=text.replace('    if (source === undefined) return undefined;','    assertManagedIdentity(agent.session, excluded);\n    if (source === undefined) return undefined;');
text=text.replace('  ctx.provide("openvikingMemory", runtime);','  ctx.provide("bookMemoryIsolation", Object.freeze({version: 1, excludes: excluded}));\n  ctx.provide("openvikingMemory", runtime);');
text=text.replace('    const decision = await next();','    assertManagedIdentity(agent.session, excluded);\n    const decision = await next();');
fs.writeFileSync(file,text);
fs.copyFileSync(path.join(root,'src/isolation.mjs'),path.join(dest,'isolation.mjs'));
pkg.name='dsh-openviking-memory-isolated';pkg.files.push('isolation.mjs');
// Preserve upstream version for its own version invariant; different package name identifies the fork.
fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify(pkg,null,2)+'\n');
fs.writeFileSync(path.join(dest,'cordis.patch.yml'),'- insert:\n    - id: openviking-memory-runtime\n      name: dsh-openviking-memory-isolated\n');
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
fs.writeFileSync(path.join(root,'artifacts/memory-fork.json'),JSON.stringify({upstream:pkg.repository,version:pkg.version,originalIndexSha256:originalHash,patchedIndexSha256:crypto.createHash('sha256').update(text).digest('hex')},null,2));
console.log('Prepared maintained memory fork; live profile unchanged');
