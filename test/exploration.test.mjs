import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {ReadingSources,parseFeed,normalizeSources} from '../src/exploration.mjs';
import {BookStore} from '../src/store.mjs';
const sources=[{id:'history',label:'History fixture',feedUrl:'https://reading.example/feed'}];
const agent={session:{header:{id:'reader',agentPreset:'book-companion'}}};
const paragraph='这篇文章提出，判断历史人物的选择，不能只看个人性格，还需要理解制度、组织与当时的信息限制。作者提出了一组与传统英雄叙事不同的解释，并承认个体选择仍然重要。';
const html=`<html><head><title>性格与制度</title></head><body><nav>菜单</nav><article><h1>性格与制度</h1>${Array.from({length:6},()=>'<p>'+paragraph+'</p>').join('')}<script>doNotRun()</script></article></body></html>`;
const xml='<rss version="2.0"><channel><title>历史</title><item><title>性格与制度</title><link>https://reading.example/article</link><description><![CDATA[<p>挑战个人性格决定历史的判断</p>]]></description></item><item><title>Unsafe</title><link>https://unrelated.example/private</link></item></channel></rss>';
export const fixtureFetch=async(url,options)=>{assert.equal(options.redirect,'manual');return new Response(url.endsWith('/feed')?xml:html,{headers:{'content-type':url.endsWith('/feed')?'application/rss+xml':'text/html'}});};
test('RSS and Atom parse metadata while rejecting unconfigured article origins and DTDs',()=>{
 const source=normalizeSources(sources)[0];assert.equal(parseFeed(xml,source).length,1);
 const atom='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>History &amp; Memory</title><link href="https://reading.example/atom"/><summary>摘要</summary></entry></feed>';
 assert.equal(parseFeed(atom,source)[0].title,'History & Memory');
 assert.throws(()=>parseFeed('<!DOCTYPE rss><rss/>',source),/DTDs/);
 assert.throws(()=>normalizeSources([{id:'bad',feedUrl:'http://127.0.0.1/'}]),/HTTPS/);
});
test('discover → read body → persistent source-based recall, without confusing metadata with reading',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'book-explore-')),store=new BookStore(path.join(dir,'db.sqlite'));
 let calls=0;const reader=new ReadingSources({sources,fetchImpl:(...args)=>{calls++;return fixtureFetch(...args);},resolveHost:async()=>[{address:'93.184.216.34'}]});
 try{
  const result=await reader.discover({query:'性格 制度'});assert.equal(result.items[0].status,'metadata-only');assert.equal(store.search(agent,'制度').length,0);
  await reader.discover({query:'性格'});assert.equal(calls,1,'feed cache avoids another request');
  const article=await reader.readArticle({url:result.items[0].url,store,agent});
  assert.equal(article.status,'body-extracted');assert.equal(article.responseTruncated,false);
  const notes=store.search(agent,'制度');assert.ok(notes.length>0);assert.equal(notes[0].kind,'material');assert.match(notes[0].source,/https:\/\/reading.example\/article#segment=1/);
  assert.equal(notes[0].text.includes('doNotRun'),false);
  const again=await reader.readArticle({url:result.items[0].url,store,agent});assert.equal(again.importStatus,'already-imported');
  await assert.rejects(()=>reader.readArticle({url:'https://unknown.example/',store,agent}),/not configured/);
  await assert.rejects(()=>reader.readArticle({url:result.items[0].url,store,agent:{}}),/identity/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('private addresses and redirects outside configured sources are refused',async()=>{
 let fetched=false;
 const privateReader=new ReadingSources({sources,resolveHost:async()=>[{address:'127.0.0.1'}],fetchImpl:async()=>{fetched=true;}});
 const result=await privateReader.discover();assert.equal(fetched,false);assert.match(result.errors[0].error,/Private/);
 const reader=new ReadingSources({sources,resolveHost:async()=>[{address:'93.184.216.34'}],fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://unknown.example/'}})});
 assert.match((await reader.discover()).errors[0].error,/outside/);
});
test('disagreements and assistant interests survive restart without user agreement',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'book-thread-')),file=path.join(dir,'db.sqlite');let store=new BookStore(file);
 try{
  store.add(agent,{kind:'assistant-interest',text:'我想继续追踪组织与个人选择的关系',source:'2026-10-29 阅读判断'});
  const thread=store.thread(agent,{action:'save',question:'性格 制度',userView:'更重视性格',assistantView:'更倾向制度解释',evidence:'fixture:对话'});
  store.close();store=new BookStore(file);
  assert.equal(store.thread(agent,{action:'list'})[0].assistantView,'更倾向制度解释');assert.equal(store.search(agent,'组织')[0].kind,'assistant-interest');
  assert.throws(()=>store.thread(agent,{action:'save',id:'guessed',question:'x',evidence:'x'}),/Unknown/);
  const review=store.review(agent,{since:'2020-01-01',until:'2090-01-01'});assert.equal(review.openThreads[0].userView,'更重视性格');
  store.thread(agent,{action:'save',id:thread.id,evidence:'new'});assert.equal(store.thread(agent,{action:'list'})[0].assistantView,'更倾向制度解释');
  store.thread(agent,{action:'save',id:thread.id,resolved:true});assert.equal(store.thread(agent,{action:'list'}).length,0);
  assert.throws(()=>store.thread({}, {action:'list'}),/identity/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
