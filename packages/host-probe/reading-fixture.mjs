// Test-only transport; never enabled in desktop or normal companion settings.
export const FIXTURE_ORIGIN='https://reading-fixture.example';
export function installReadingFixture(ctx){
 const paragraph='这是一份专为验收编写的虚构阅读材料，并非《史记》原文或历史研究。材料的观点是：人物的选择既受到性格影响，也取决于组织怎样处理信息。把组织反馈称为“双向信使机制”是这份测试材料自造的标签，不是历史事实。它要求同时追踪消息上行和判断下行，避免只用成败解释一个人的性格。';
 const html='<html><head><title>测试材料：性格与组织反馈</title></head><body><article><h1>测试材料：性格与组织反馈</h1>'+Array.from({length:5},()=>'<p>'+paragraph+'</p>').join('')+'</article></body></html>';
 const feed='<rss version="2.0"><channel><title>测试阅读源</title><item><title>性格与组织反馈</title><link>'+FIXTURE_ORIGIN+'/article</link><description>一份与性格、制度和组织有关的虚构讨论材料。</description></item></channel></rss>';
 ctx.provide('bookReadingTransport',{
  async resolveHost(host){if(host!=='reading-fixture.example')throw new Error('Fixture transport origin refused');return [{address:'93.184.216.34'}];},
  async fetchImpl(input){const u=new URL(input);if(u.origin!==FIXTURE_ORIGIN)throw new Error('Fixture transport origin refused');if(!['/feed','/article'].includes(u.pathname))return new Response('Not found',{status:404});return new Response(u.pathname==='/feed'?feed:html,{headers:{'content-type':u.pathname==='/feed'?'application/rss+xml':'text/html'}});}
 });
}
