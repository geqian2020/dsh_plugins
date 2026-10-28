import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createProductionController} from '../vendor/dsh-im-source/dsh-im-main/plugin-src/host/channels/qq/production.mjs';
test('patched QQ production actually applies the locked book route',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'book-qq-production-')),workspace=path.join(dir,'book-workspace');
 let controllerOptions,runtimeOptions,created;
 const live=new Map();
 class ConfigStore{async load(){return this;}list(){return [];}}
 class StateStore{async load(){return this;}async clearSessions(){}}
 class Harness{
  stopManagedProcess(){}
  async createSession(options){created=options;live.set('book-new',{header:{agentPreset:options.agentPreset,cwd:options.workspace}});return 'book-new';}
  async ask(id){return id;}
 }
 class Controller{constructor(options){controllerOptions=options;}async close(){}}
 class Runtime{constructor(options){runtimeOptions=options;}}
 class QrAuth{}
 const supervisor={ready:Promise.resolve(),start(){return this;},async close(){}};
 let production;
 try{
  production=await createProductionController({credentials:{},typertGateway:{invoke(){},stream(){}},logger:()=>({error(){},warn(){},info(){},debug(){}}),get(name){return name==='sessions'?{get:id=>live.get(id)}:undefined;}},
   {dataDir:dir,bookCompanionBots:{reader:{workspace}}},
   {ConfigStore,StateStore,HarnessClient:Harness,Controller,Runtime,QrAuth,createConnectionSupervisor:()=>supervisor});
  await controllerOptions.createRuntime({botId:'reader',config:{botId:'reader',appId:'test-app'},appSecret:'not-a-real-secret'});
  assert.equal(await runtimeOptions.harness.createSession({conversationKey:'qq:user:one'}),'book-new');
  assert.equal(created.agentPreset,'book-companion');assert.equal(created.workspace,workspace);
  assert.throws(()=>runtimeOptions.harness.updateAgentPreset('standard'),/锁定/);
  await assert.rejects(async()=>runtimeOptions.harness.ask('main-session','hello'),/未绑定/);
 }finally{await production?.close();await fs.rm(dir,{recursive:true,force:true});}
});
