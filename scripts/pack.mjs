import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'dist');fs.mkdirSync(out,{recursive:true});
function octal(buf,offset,size,value){buf.write(value.toString(8).padStart(size-1,'0')+'\0',offset,size,'ascii');}
function packageTar(directory){
 const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'))),entries=[];
 const allowed=new Set(['package.json','LICENSE','README.md',...(pkg.files??[]).map(p=>p.split('/')[0])]);
 function walk(dir,prefix='package'){
  for(const item of fs.readdirSync(dir,{withFileTypes:true})){
   if(item.name==='node_modules'||item.name.startsWith('.'))continue;
   if(prefix==='package'&&pkg.files&&!allowed.has(item.name))continue;
   const name=prefix+'/'+item.name,full=path.join(dir,item.name);
   if(item.isDirectory()){walk(full,name);continue;}
   if(!item.isFile())continue;
   let short=name,pre='';
   if(Buffer.byteLength(name)>100){const cut=name.lastIndexOf('/');short=name.slice(cut+1);pre=name.slice(0,cut);if(Buffer.byteLength(short)>100||Buffer.byteLength(pre)>155)throw new Error('Tar filename too long: '+name);}
   const data=fs.readFileSync(full),h=Buffer.alloc(512);
   h.write(short);if(pre)h.write(pre,345);octal(h,100,8,0o644);octal(h,108,8,0);octal(h,116,8,0);octal(h,124,12,data.length);octal(h,136,12,0);h.fill(32,148,156);h[156]=48;h.write('ustar\0',257);h.write('00',263);
   const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
   entries.push(h,data,Buffer.alloc((512-data.length%512)%512));
  }
 }walk(directory);entries.push(Buffer.alloc(1024));
 const filename=path.join(out,pkg.name.replaceAll('@','').replaceAll('/','-')+'-'+pkg.version+'.tgz');
 const bytes=zlib.gzipSync(Buffer.concat(entries));fs.writeFileSync(filename,bytes);
 return {file:path.basename(filename),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
const packages=['packages/book-companion','packages/openviking-memory-isolated','vendor/dsh-im-source/dsh-im-main'].map(p=>packageTar(path.join(root,p)));
fs.writeFileSync(path.join(out,'checksums.json'),JSON.stringify(packages,null,2));console.log(JSON.stringify(packages,null,2));
