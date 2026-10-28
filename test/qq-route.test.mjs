import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {lockBookHarness} from '../patches/dsh-im/book-route.mjs';
test('QQ route pins creation, rejects cross-session commands, and survives restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'book-qq-')),workspace=path.join(dir,'workspace'),registryPath=path.join(dir,'sessions.json');
 const calls=[];let live;
 const harness={async createSession(opts){calls.push(opts);return 'book-1';},async ask(id){return id;},async sessionExists(){return true;}};
 const settings={botId:'reader',workspace,registryPath,resolveLiveSession:()=>live};
 try{
  let route=lockBookHarness(harness,settings);
  assert.equal(await route.createSession({agentPreset:'standard',workspace:path.join(dir,'main')}),'book-1');
  assert.equal(calls[0].agentPreset,'book-companion');assert.equal(calls[0].workspace,workspace);
  assert.throws(()=>route.ask('main-1'),/未绑定/);
  assert.throws(()=>route.executeCommand('book-1','/fork'),/锁定/);
  route=lockBookHarness(harness,settings);
  assert.equal(await route.ask('book-1'),'book-1');
  assert.throws(()=>lockBookHarness(harness,{...settings,botId:'other'}).ask('book-1'),/未绑定/);
  live={header:{agentPreset:'standard',cwd:workspace}};
  assert.throws(()=>route.ask('book-1'),/身份不匹配/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
