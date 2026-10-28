import {build} from '../build-tools/node_modules/esbuild/lib/main.js';
import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),im=path.join(root,'vendor/dsh-im-source/dsh-im-main');
const pkg=JSON.parse(fs.readFileSync(path.join(im,'package.json')));
if(pkg.name==='@xmanrui/dsh-im'){
 pkg.name='dsh-im-book-isolated';pkg.version+='-book.1';
 fs.writeFileSync(path.join(im,'package.json'),JSON.stringify(pkg,null,2)+'\n');
 fs.writeFileSync(path.join(im,'cordis.patch.yml'),'- insert:\n    - id: xmanrui-dsh-im\n      name: dsh-im-book-isolated\n');
}
fs.mkdirSync(path.join(im,'lib'),{recursive:true});
const host=await build({entryPoints:[path.join(im,'plugin-src/host/index.mjs')],bundle:true,format:'esm',platform:'node',target:'node24',packages:'external',metafile:true,outfile:path.join(im,'lib/index.js'),banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"}});
const external=[...new Set(Object.values(host.metafile.outputs).flatMap(o=>o.imports).filter(i=>i.external&&!i.path.startsWith('node:')).map(i=>i.path.startsWith('@')?i.path.split('/').slice(0,2).join('/'):i.path.split('/')[0]))];
for(const name of external){if(!pkg.dependencies?.[name]&&!pkg.optionalDependencies?.[name]&&pkg.devDependencies?.[name]&&!name.startsWith('@deepseek-ai/'))pkg.dependencies[name]=pkg.devDependencies[name];}
// This fork does not include optional QQ-mail CLI or sharp image recompression.
// Image input itself remains supported through the host's image-input pipeline.
delete pkg.optionalDependencies;
fs.writeFileSync(path.join(im,'package.json'),JSON.stringify(pkg,null,2)+'\n');
const result=await build({entryPoints:[path.join(im,'plugin-src/client/index.js')],bundle:true,format:'cjs',platform:'browser',target:'chrome100',packages:'external',write:false});
fs.writeFileSync(path.join(im,'lib/client.js'),`window.__ModuleLoader__.load({id:'dsh-im-book-isolated',factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;}});`);
fs.writeFileSync(path.join(root,'artifacts/im-build.json'),JSON.stringify({package:pkg.name,version:pkg.version,external,status:'built-external-runtime-dependencies-not-installed',note:'Host imports remain external. Production dependency install and QQ account smoke test required.'},null,2));
console.log('Built QQ adapter with external runtime dependencies; not installed in live profile');
