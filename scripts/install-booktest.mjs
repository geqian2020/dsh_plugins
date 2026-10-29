import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const profile=path.join(process.env.USERPROFILE,'.dsh/profiles/booktest');
if(!fs.existsSync(path.join(profile,'package.json')))throw new Error('Existing booktest profile required');
const backup=path.join(profile,'backups',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(backup,{recursive:true});fs.copyFileSync(path.join(profile,'package.json'),path.join(backup,'package.json'));
for(const [source,name]of [['book-companion','dsh-book-companion'],['host-check','dsh-book-host-check'],['host-probe','dsh-host-probe']]){
 const target=path.join(profile,'node_modules',name);
 if(fs.existsSync(target))fs.cpSync(target,path.join(backup,name),{recursive:true});
 fs.cpSync(path.join(root,'packages',source),target,{recursive:true});
 if(source==='book-companion'){
  const deps=path.join(target,'node_modules');fs.mkdirSync(deps,{recursive:true});
  for(const entry of fs.readdirSync(path.join(root,'node_modules'),{withFileTypes:true}))if(entry.isDirectory()&&!entry.name.startsWith('.'))fs.cpSync(path.join(root,'node_modules',entry.name),path.join(deps,entry.name),{recursive:true});
 }
}
const manifest=JSON.parse(fs.readFileSync(path.join(profile,'package.json')));
manifest.dependencies['dsh-book-companion']='file:'+path.join(root,'dist/dsh-book-companion-0.2.0.tgz').replaceAll('\\','/');
fs.writeFileSync(path.join(profile,'package.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Updated booktest only. Backup: '+backup);
