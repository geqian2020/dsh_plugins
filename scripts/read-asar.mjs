import fs from 'node:fs';
import path from 'node:path';
const p=path.join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness/resources/app.asar');
const f=fs.openSync(p,'r'), b=Buffer.alloc(16);fs.readSync(f,b,0,16,0);
const h=Buffer.alloc(b.readUInt32LE(12));fs.readSync(f,h,0,h.length,16);
const tree=JSON.parse(h),base=8+b.readUInt32LE(4);
for(const q of process.argv.slice(2)){
 let e=tree;for(const k of q.split('/'))e=e.files[k];
 if(e.files){console.log(q,Object.keys(e.files));continue;}
 const v=e.unpacked?fs.readFileSync(p+'.unpacked/'+q):Buffer.alloc(e.size);
 if(!e.unpacked)fs.readSync(f,v,0,v.length,base+Number(e.offset));
 if(process.env.ASAR_OUTPUT){const dest=path.resolve(process.env.ASAR_OUTPUT,q);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,v);console.log(dest);}else console.log('FILE '+q+'\n'+v.toString());
}fs.closeSync(f);
