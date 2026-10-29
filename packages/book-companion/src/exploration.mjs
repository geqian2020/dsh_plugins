import {SaxesParser} from 'saxes';
import {parseHTML} from 'linkedom';
import {Readability} from '@mozilla/readability';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {EPISODE_HEADERS,segmentTranscript} from './materials.mjs';

export function normalizeSources(input=[]){
  if(!Array.isArray(input)||input.length>12)throw new Error('readingSources must contain at most 12 sources');
  const ids=new Set();
  return input.map(s=>{
    if(!s||typeof s.id!=='string'||!/^[-a-z0-9]{1,64}$/i.test(s.id)||ids.has(s.id))throw new Error('Unique reading source id required');
    ids.add(s.id);const feed=new URL(s.feedUrl);
    if(feed.protocol!=='https:'||feed.username||feed.password||feed.port||isIP(feed.hostname)||feed.hostname==='localhost'||feed.hostname.endsWith('.local'))throw new Error('Public HTTPS feed required');
    const origins=[feed.origin,...(s.articleOrigins??[])].map(value=>{
      const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||isIP(u.hostname)||u.hostname==='localhost'||u.hostname.endsWith('.local'))throw new Error('Public HTTPS article origin required');return u.origin;
    });
    return {id:s.id,label:String(s.label??s.id).slice(0,100),feedUrl:feed.href,origins:[...new Set(origins)]};
  });
}
export function parseFeed(xml,source){
  const parser=new SaxesParser({xmlns:false}),items=[];let stack=[],item=null,field=null,buffer='';
  parser.on('doctype',()=>{throw new Error('Feed DTDs are not supported');});
  parser.on('opentag',node=>{
    stack.push(node.name);
    if(node.name==='item'||node.name==='entry')item={};
    if(!item)return;
    if(node.name==='link'&&node.attributes.href&&(!node.attributes.rel||node.attributes.rel==='alternate'))item.url=String(node.attributes.href);
    if(['title','link','description','summary','content','pubDate','published','updated'].includes(node.name)){field=node.name;buffer='';}
  });
  const append=value=>{if(field)buffer+=value;};parser.on('text',append);parser.on('cdata',append);
  parser.on('closetag',node=>{
    if(item&&field===node.name){const value=buffer.trim();if(node.name==='title')item.title=value;else if(node.name==='link'&&value)item.url=value;else if(['description','summary','content'].includes(node.name))item.summary=value;else item.published=value;field=null;buffer='';}
    if(item&&(node.name==='item'||node.name==='entry')){
      try{const url=new URL(item.url,source.feedUrl);url.hash='';if(item.title&&source.origins.includes(url.origin)&&!url.username&&!url.password)items.push({...item,url:url.href,sourceId:source.id,source:source.label,status:'metadata-only',summary:plainText(item.summary??'').slice(0,1500)});}catch{/* Ignore missing/unsupported links. */}
      item=null;
    }stack.pop();
  });
  parser.write(xml).close();return items.slice(0,60);
}
function plainText(html){const {document}=parseHTML('<html><body>'+html+'</body></html>');for(const e of document.querySelectorAll('script,style,noscript'))e.remove();return document.body.textContent.replace(/\s+/g,' ').trim();}
function privateAddress(a){
  const ip=a.toLowerCase().replace(/^::ffff:/,'');
  return /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)||ip==='::1'||ip==='::'||/^(fc|fd|fe[89ab])/.test(ip);
}
export class ReadingSources{
  constructor({sources=[],fetchImpl=fetch,resolveHost=hostname=>lookup(hostname,{all:true}),transportProvider=()=>undefined,clock=()=>Date.now()}={}){
    this.sources=normalizeSources(sources);this.fetch=(...args)=>(transportProvider()?.fetchImpl??fetchImpl)(...args);this.resolveHost=(...args)=>(transportProvider()?.resolveHost??resolveHost)(...args);this.clock=clock;this.cache=new Map();
  }
  async request(input,origins,signal){
    let url=new URL(input);
    for(let hop=0;hop<4;hop++){
      if(!origins.includes(url.origin)||url.username||url.password)throw new Error('Source URL outside configured origins');
      const addresses=await this.resolveHost(url.hostname);
      if(!addresses.length||addresses.some(a=>privateAddress(a.address)))throw new Error('Private network sources are not allowed');
      const res=await this.fetch(url.href,{headers:EPISODE_HEADERS,redirect:'manual',signal:AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])])});
      if([301,302,303,307,308].includes(res.status)){await res.body?.cancel();url=new URL(res.headers.get('location'),url);continue;}
      if(!res.ok)throw new Error('Source request failed: '+res.status);
      const chunks=[];let size=0;for await(const chunk of res.body){size+=chunk.length;if(size>2*1024*1024)throw new Error('Source response exceeds 2 MiB');chunks.push(chunk);}
      return {url:url.href,text:Buffer.concat(chunks).toString('utf8'),contentType:res.headers.get('content-type')??''};
    }throw new Error('Too many source redirects');
  }
  async discover({query='',signal}={}){
    if(typeof query!=='string'||query.length>300)throw new Error('Short discovery query required');
    const ignored=new Set(['什么','为什么','如何','共同','影响','一个','我们','你们','这个','那个']);
    const terms=[...new Set([...new Intl.Segmenter('zh',{granularity:'word'}).segment(query.toLowerCase())].filter(s=>s.isWordLike&&[...s.segment].length>1&&!ignored.has(s.segment)).map(s=>s.segment))];
    const results=await Promise.allSettled(this.sources.map(async source=>{
      let cached=this.cache.get(source.id);
      if(!cached||this.clock()-cached.at>15*60*1000){const body=await this.request(source.feedUrl,source.origins,signal);cached={at:this.clock(),items:parseFeed(body.text,source)};this.cache.set(source.id,cached);}
      return cached.items;
    }));
    signal?.throwIfAborted();
    const items=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
    const unique=[...new Map(items.map(i=>[i.url,i])).values()];
    const ranked=unique.map(i=>({...i,matchedTerms:terms.filter(t=>(i.title+' '+i.summary).toLowerCase().includes(t))})).sort((a,b)=>b.matchedTerms.length-a.matchedTerms.length);
    return {configuredSources:this.sources.map(s=>({id:s.id,label:s.label})),query,items:ranked.slice(0,12),errors:results.flatMap((r,i)=>r.status==='rejected'?[{sourceId:this.sources[i].id,error:String(r.reason?.message??r.reason)}]:[]),notice:'候选来自订阅元数据，尚未阅读正文；匹配分数不是观点或推荐质量判断。'};
  }
  async readArticle({url,store,agent,signal}){
    const parsed=new URL(url);parsed.hash='';const source=this.sources.find(s=>s.origins.includes(parsed.origin));
    if(!source)throw new Error('Article source is not configured');
    const page=await this.request(parsed.href,source.origins,signal);
    if(!/text\/html|application\/xhtml\+xml/i.test(page.contentType))throw new Error('Expected an HTML article');
    const {document}=parseHTML(page.text);for(const e of document.querySelectorAll('script,style,noscript,iframe,form'))e.remove();
    const article=new Readability(document,{charThreshold:200,maxElemsToParse:20000}).parse();
    if(!article?.content)throw new Error('Readable article body unavailable; do not infer it from the title');
    const {document:body}=parseHTML('<html><body>'+article.content+'</body></html>');
    const paragraphs=[...body.querySelectorAll('p,h1,h2,h3,blockquote,li')].filter(e=>!e.parentElement?.closest('p,blockquote,li')).map(e=>e.textContent.trim()).filter(Boolean);
    const text=paragraphs.length?paragraphs.join('\n\n'):body.body.textContent.trim();
    if(text.length<100)throw new Error('Article body too short to verify');
    const segments=segmentTranscript({text:(article.title?article.title+'\n\n':'')+text,source:page.url});const imported=store.importTranscript(agent,segments);
    return {title:article.title||parsed.hostname,url:page.url,...imported,importStatus:imported.status,status:'body-extracted',coverage:'正文提取结果，不保证与原页面逐字完整一致',segments:segments.slice(0,12).map((s,i)=>({number:i+1,text:s.text,source:s.source})),storedSegments:segments.length,responseTruncated:segments.length>12};
  }
}
