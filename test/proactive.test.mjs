import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {BookStore} from '../src/store.mjs';import {createProactiveReader} from '../src/proactive.mjs';
test('proactive reader preserves disagreement, waits for idle, and does not resubmit after restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'book-proactive-')),file=path.join(dir,'db.sqlite');let store=new BookStore(file);
 const sent=[];const agent={status:'idle',session:{id:'book-active',header:{id:'book-active',agentPreset:'book-companion'}},followup:m=>sent.push(m)};
 let time=Date.parse('2026-10-29T06:00:00Z'),reads=0;
 const reader={async discover(){return {items:[{url:'https://reading.example/a',matchedTerms:['制度']}]};},async readArticle(){reads++;return {title:'制度与选择',url:'https://reading.example/a',status:'body-extracted'};}};
 const make=enabled=>createProactiveReader({store,reader,lookupAgent:()=>agent,makeMessage:m=>m,config:{enabled,idleMinutes:30},now:()=>time});
 const observe=run=>run.observe(agent.session,{type:'user/message',data:{source:{kind:'user'}}});
 let run=make(true);
 try{
  store.thread(agent,{action:'save',question:'制度',userView:'性格更重要',assistantView:'仍然有分歧',evidence:'fixture:chat'});
  observe(run);assert.equal((await run.tick()).status,'quiet');time+=31*60000;
  agent.status='running';assert.equal((await run.tick()).status,'busy-or-unavailable');agent.status='idle';
  assert.equal((await run.tick()).status,'submitted-to-dsh-session');assert.equal(sent.length,1);assert.match(sent[0].content[0].text,/仍然有分歧/);assert.equal(sent[0].source.kind,'plugin:book-companion');
  assert.equal((await run.tick()).status,'already-considered');assert.equal(reads,1);
  run.close();store.close();store=new BookStore(file);run=make(true);observe(run);time+=31*60000;
  assert.equal((await run.tick()).status,'already-considered');assert.equal(sent.length,1);
  run.close();run=make(false);observe(run);time+=31*60000;assert.equal((await run.tick()).status,'idle');
 }finally{run.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('assistant can explore its own saved interest without inventing user preferences',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'book-own-interest-')),store=new BookStore(path.join(dir,'db.sqlite'));
 const sent=[],agent={status:'idle',session:{id:'reader',header:{id:'reader',agentPreset:'book-companion'}},followup:m=>sent.push(m)};
 let time=Date.parse('2026-10-29T06:00:00Z');
 const reader={async discover({query}){assert.match(query,/信息/);return {items:[{url:'https://reading.example/interest',matchedTerms:['信息']}]};},async readArticle(){return {title:'信息与组织',status:'body-extracted'};}};
 const run=createProactiveReader({store,reader,lookupAgent:()=>agent,makeMessage:m=>m,config:{enabled:true},now:()=>time});
 try{
  store.add(agent,{kind:'assistant-interest',text:'我想继续追踪信息如何在组织中流动',source:'fixture:assistant-reading'});
  run.observe(agent.session,{type:'user/message',data:{source:{kind:'user'}}});time+=31*60000;
  assert.equal((await run.tick()).status,'submitted-to-dsh-session');
  const context=JSON.parse(sent[0].content[0].text);assert.equal(context.thread.origin,'assistant-interest');assert.match(context.thread.userView,/尚未/);
 }finally{run.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
