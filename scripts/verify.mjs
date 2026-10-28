import {spawnSync}from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const tests=fs.readdirSync(path.join(root,'test')).filter(f=>f.endsWith('.test.mjs')).map(f=>'test/'+f);
const result=spawnSync(process.execPath,['--test',...tests],{cwd:root,encoding:'utf8'});
process.stdout.write(result.stdout);process.stderr.write(result.stderr);
const profile=path.join(process.env.USERPROFILE,'.dsh/profiles/desktop/package.json');
const report={at:new Date().toISOString(),exitCode:result.status,output:result.stdout+result.stderr,environment:'Installed DSH runtime snapshot; real tool/prompt services; memory lifecycle uses recorded fake service',liveProfileChanged:false,liveProfileSha256:crypto.createHash('sha256').update(fs.readFileSync(profile)).digest('hex'),notVerified:['Complete live host composition and real model requests','OpenViking network request audit','QQ account delivery','Full podcast transcription and external ASR','Scheduled proactive delivery','Seven-day companion quality and latency/cost']};
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/verification.json'),JSON.stringify(report,null,2));
process.exit(result.status??1);
