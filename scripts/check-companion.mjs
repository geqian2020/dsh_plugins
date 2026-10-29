import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import net from 'node:net';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),art=path.join(root,'artifacts');
const real=process.argv.includes('--real');
const runDir=fs.mkdtempSync(path.join(os.tmpdir(),'book-companion-check-'));
const app=path.join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness');
const executable=path.join(app,'resources/runtime/primary-runtime/dependencies/node/bin/node.exe');
const cli=path.join(root,'vendor/installed-runtime/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js');
const port=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});});
const children=new Set();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function start(exe,args,env,log){
 const fd=fs.openSync(log,'w');const child=spawn(exe,args,{cwd:root,windowsHide:true,env:{...process.env,...env},stdio:['ignore',fd,fd]});fs.closeSync(fd);children.add(child);
 child.on('exit',()=>children.delete(child));child.on('error',error=>{child.spawnError=error;});return child;
}
let gateway;
try{
 const gatewayPort=await port();
 const fakeLog=path.join(art,'companion-fake-requests.jsonl');
 gateway=start(process.execPath,[path.join(root,'scripts/fake-llm-server.mjs')],{FAKE_LLM_PORT:String(gatewayPort),FAKE_LLM_LOG:fakeLog},path.join(runDir,'gateway.log'));
 let ready=false;for(let i=0;i<100;i++){try{const res=await fetch(`http://127.0.0.1:${gatewayPort}/v1/models`);if(res.ok){ready=true;break;}}catch{}await delay(100);}if(!ready)throw new Error('Fake gateway did not start');
 const results=[];
 for(const mode of real?['fake','real','exploration-real']:['fake']){
  const dataDir=path.join(runDir,mode),reportName=`companion-${mode}.json`,reportPath=path.join(art,reportName);
  const patch=path.join(runDir,mode+'.patch.yml');
  const lines=[
   {id:'preset-book-companion',config:{id:'book-companion',plugins:[{id:'book-companion-runtime',name:'dsh-book-companion',config:{dataDir,readingSources:[{id:'fixture',feedUrl:'https://reading-fixture.example/feed'}]}}]}},
   {id:'host-probe',config:{readingFixture:true,outFile:path.join(runDir,mode+'-probe.jsonl')}},
   {id:'llm-pi-ai',config:{providers:{'fake-gateway':{displayName:'Fake Gateway',apiKeyEnv:'FAKE_LLM_KEY',api:'openai-completions',baseURL:`http://127.0.0.1:${gatewayPort}/v1`,models:[{id:'fake-model',name:'Fake Model',contextWindow:200000,maxTokens:16384}]}}}},
   {id:'agent-default-model',config:{provider:mode==='fake'?'fake-gateway':'deepseek-official',model:mode==='fake'?'fake-model':'deepseek-flash'}},
   {id:'book-host-check',config:{mode,cwd:path.join(runDir,'workspace'),profileName:'booktest',reportFile:reportName,secret:'SMOKE_'+path.basename(runDir)}}
  ];
  // JSON entry lists are valid YAML and avoid generated indentation/escaping bugs.
  fs.writeFileSync(patch,JSON.stringify(lines,null,2));if(fs.existsSync(reportPath))fs.unlinkSync(reportPath);
  const child=start(executable,['--expose-internals',cli,'booktest','--patch',patch,'--no-open','--port',String(await port())],{ELECTRON_RUN_AS_NODE:'1',FAKE_LLM_KEY:'fake-key',BOOK_TEST_DATA_DIR:dataDir,FAKE_LLM_LOG:fakeLog,BOOK_HOST_CHECK_LOG:path.join(runDir,'host-check.log')},path.join(runDir,mode+'-host.log'));
  const deadline=Date.now()+5*60000;let report;
  while(Date.now()<deadline){if(child.spawnError)throw child.spawnError;if(fs.existsSync(reportPath)){try{report=JSON.parse(fs.readFileSync(reportPath));break;}catch{}}if(child.exitCode!==null)break;await delay(250);}
  if(!report)throw new Error('Host check missing report for '+mode+'; inspect '+path.join(runDir,mode+'-host.log'));
  if(child.exitCode===null){await delay(1000);if(child.exitCode===null)child.kill();}
  results.push({mode,ok:report.ok,pass:report.checks?.filter(c=>c.pass).length??0,total:report.checks?.length??0,report:reportName});
  console.log(JSON.stringify(results.at(-1)));
  if(!report.ok)throw new Error('Host check failed: '+mode);
 }
 fs.writeFileSync(path.join(art,'companion-host-verification.json'),JSON.stringify({at:new Date().toISOString(),ok:results.every(r=>r.ok),profile:'booktest',launch:'Installed bundled Node and CLI extracted from the installed DSH archive',isolatedTestData:true,runDir,results,notVerified:['Real OpenViking network audit','QQ proactive delivery','External feed availability and recommendation quality','Seven-day user experience']},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}finally{for(const child of children)child.kill();}
