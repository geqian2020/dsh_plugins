import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPolicy,memoryToolGuard } from '../src/isolation.mjs';
import { BookStore } from '../src/store.mjs';
const book={session:{header:{id:'book-1',agentPreset:'book-companion'}}};
const main={session:{header:{id:'main-1',agentPreset:'standard'}}};
test('persistent identity and protected workspace exclusion',()=>{
  const root=path.resolve('data/protected'),p=createPolicy({excludeWorkspaceRoots:[root]});
  assert.equal(p(book.session),true);assert.equal(p(main.session),false);
  assert.equal(p({header:{cwd:path.join(root,'child')}}),true);
  assert.equal(p({header:{cwd:root+'-other'}}),false);
  assert.equal(p(JSON.parse(JSON.stringify(book.session))),true);
  assert.throws(()=>createPolicy({excludeWorkspaceRoots:['relative']}));
});
test('main memory execution denied for companion',()=>{
  const g=memoryToolGuard(createPolicy());
  assert.match(g({agent:book,name:'mcp__openviking__remember'}),/cannot access/);
  assert.equal(g({agent:main,name:'mcp__openviking__remember'}),undefined);
});
test('private store persists, separates authors, enforces identity and deletion',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'book-store-')),file=path.join(dir,'reading.sqlite');
  let store=new BookStore(file);
  try{
    const r=store.add(book,{kind:'user-view',text:'读史记时我重视承诺。',source:'session:book-1/user:1'});
    store.add(book,{kind:'assistant-view',text:'史记故事也可以从制度约束理解。',source:'session:book-1/assistant:1'});
    assert.equal(store.search(book,'史记').length,2);
    assert.throws(()=>store.search(main,'史记'),/identity/);
    assert.throws(()=>store.add(undefined,{text:'x'}),/identity/);
    assert.throws(()=>store.add(book,{kind:'personality',text:'你是胆小的人',source:'guess'}));
    store.close();store=new BookStore(file);
    assert.equal(store.search(book,'承诺')[0].kind,'user-view');
    store.remove(book,r.id);assert.equal(store.search(book,'承诺').length,0);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('dialogue capture excludes injected context and preserves deletion on replay',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'book-capture-')),store=new BookStore(path.join(dir,'db.sqlite'));
 try{
  const event={seq:1,type:'user/message',time:Date.now(),data:{role:'user',source:{kind:'user'},content:[{type:'text',text:'我对史记有新的想法'}]}};
  store.capture(book.session,event);store.capture(book.session,event);
  store.capture(book.session,{...event,seq:2,data:{...event.data,source:{kind:'time-context'}}});
  const rows=store.search(book,'史记');assert.equal(rows.length,1);assert.equal(rows[0].kind,'user-utterance');
  store.remove(book,rows[0].id);store.capture(book.session,event);assert.equal(store.search(book,'史记').length,0);
  assert.throws(()=>store.capture(main.session,event),/identity/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
