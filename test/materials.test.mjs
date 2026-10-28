import {test} from 'node:test';
import assert from 'node:assert/strict';
import {episodeUrl,extractEpisode,fetchEpisode,segmentTranscript} from '../src/materials.mjs';
const url='https://www.xiaoyuzhoufm.com/episode/0123456789abcdef01234567';
test('episode network boundary rejects arbitrary URLs and redirect input',()=>{
 assert.equal(episodeUrl(url+'?share=1'),url);
 for(const input of ['http://127.0.0.1/','https://www.xiaoyuzhoufm.com.evil.test/episode/0123456789abcdef01234567','file:///C:/secret',url.replace('https:','http:')])assert.throws(()=>episodeUrl(input));
});
test('metadata extraction never claims complete reading',async()=>{
 const html='<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{episode:{title:'史记故事',description:'节目简介',enclosure:{url:'https://audio.example/1.m4a'}}}}})+'</script>';
 const item=await fetchEpisode(url,{fetchImpl:async(_url,opts)=>{assert.equal(opts.redirect,'error');return new Response(html);}});
 assert.equal(item.status,'metadata-only');assert.match(item.warning,/尚未/);
 assert.throws(()=>extractEpisode('<h1>节目标题</h1>',url),/unavailable/);
});
test('transcript segmentation preserves exact text and stable source references',()=>{
 const text='张'.repeat(3600),segments=segmentTranscript({text,source:'fixture:史记'});
 assert.equal(segments.length,3);assert.equal(segments.map(s=>s.text).join(''),text);
 assert.match(segments[2].source,/#segment=3$/);
 assert.equal(segmentTranscript({text,source:'fixture:史记'})[0].digest,segments[0].digest);
});
