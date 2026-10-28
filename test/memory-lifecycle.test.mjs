import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPolicy,memoryToolGuard,assertManagedIdentity,BOOK_WORKSPACE} from '../src/isolation.mjs';
test('patched upstream lifecycle never admits book sessions; normal sessions still work',async()=>{
 const source=fs.readFileSync(new URL('../packages/openviking-memory-isolated/index.mjs',import.meta.url),'utf8');
 const body=source.replace(/^import .*;\r?\n/gm,'').replaceAll('export const ','const ').replace('export function apply','function apply');
 const calls=[],handlers=new Map(),effects=[];
 class Runtime {
  constructor(){this.log=()=>{};}
  startDrainer(){}stopDrainer(){}disposeAll(){}
  dispose(s){calls.push(['dispose',s.header.id]);}
  profileMessage(a){calls.push(['profile',a.session.header.id]);return {role:'user',content:'MAIN_PROFILE_SENTINEL'};}
  recallMessage(a){calls.push(['recall',a.session.header.id]);return {role:'user',content:'MAIN_MEMORY_SENTINEL'};}
  capture(s){calls.push(['capture',s.header.id]);}
  maybeCommit(s){calls.push(['commit',s.header.id]);}
  flush(s){calls.push(['flush',s.header.id]);}
 }
 const deps={createPolicy,memoryToolGuard,assertManagedIdentity,resolveConfig:()=>({}),OpenVikingClient:class{},OpenVikingRuntime:Runtime,
  injectStartupProfile:(a)=>{calls.push(['startup',a.session.header.id]);return false;},mountOpenVikingMcp:()=>{},mountOpenVikingSkills:()=>{},guardVikingUri:()=>{},noticeVikingUri:()=>{}};
 const apply=new Function(...Object.keys(deps),body+'\nreturn apply;')(...Object.values(deps));
 const ctx={logger:{},provide(){},effect(){},tools:{guard(){}},on(name,fn){handlers.set(name,fn);}};
 apply(ctx);
 const make=(id,agentPreset)=>({session:{header:{id,agentPreset}},ctx:{effect:f=>effects.push(f())}});
 const book=make('book-1','book-companion'),main=make('main-1','standard');
 const signal=new AbortController().signal;
 const enter={kind:'enter',messages:[{role:'user',content:'USER_TEXT'}]};
 for(const agent of [book,make('book-2','book-companion'),main]){
  await handlers.get('agent/created')({agent,source:'created',signal});
  await handlers.get('agent/session-start')({agent});
  const decision=await handlers.get('agent/pre-step')({agent,signal},()=>Promise.resolve(enter));
  if(agent.session.header.agentPreset==='book-companion')assert.deepEqual(decision,enter);
  else assert.equal(decision.messages.length,3);
  handlers.get('session/event')(agent.session,{type:'message'});
  await handlers.get('session/flush')(agent.session);
 }
 for(const dispose of effects)await dispose();
 const unsafe=make('unsafe-fork','standard');unsafe.session.header.cwd=BOOK_WORKSPACE;
 await assert.rejects(()=>handlers.get('agent/created')({agent:unsafe,source:'fork',signal}),/unsafe fork/);
 await assert.rejects(()=>handlers.get('agent/pre-step')({agent:unsafe,signal},()=>Promise.resolve(enter)),/unsafe fork/);
 assert.equal(calls.some(c=>c[1].startsWith('book-')),false,JSON.stringify(calls));
 assert.deepEqual(calls.map(c=>c[0]).sort(),['startup','profile','recall','capture','commit','flush','dispose'].sort());
});
