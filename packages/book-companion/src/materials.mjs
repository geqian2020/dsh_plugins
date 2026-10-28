import {createHash} from 'node:crypto';
export function episodeUrl(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.hostname!=='www.xiaoyuzhoufm.com'||u.port||u.username||u.password||!/^\/episode\/[a-f\d]{24}\/?$/i.test(u.pathname))throw new Error('Only canonical Xiaoyuzhou episode links are supported');
 return `https://${u.hostname}${u.pathname.replace(/\/$/,'')}`;
}
export function extractEpisode(html,url){
 const match=html.match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
 if(!match)throw new Error('Episode page data unavailable; provide transcript instead');
 const data=JSON.parse(match[1]),episode=data?.props?.pageProps?.episode;
 if(!episode||typeof episode.title!=='string')throw new Error('Unsupported episode data; no content inferred');
 return {url,title:episode.title,description:typeof episode.description==='string'?episode.description:'',audioUrl:episode.enclosure?.url??null,status:'metadata-only',warning:'只有标题与简介，尚未听过完整音频；需要转写才能逐段核对复述。'};
}
export async function fetchEpisode(url,{fetchImpl=fetch,signal}={}){
 const canonical=episodeUrl(url);
 const res=await fetchImpl(canonical,{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])])});
 if(!res.ok)throw new Error(`Episode fetch failed (${res.status})`);
 const chunks=[];let size=0;
 for await(const chunk of res.body){size+=chunk.length;if(size>4*1024*1024){await res.body.cancel?.().catch(()=>{});throw new Error('Episode page too large');}chunks.push(chunk);}
 return extractEpisode(Buffer.concat(chunks).toString('utf8'),canonical);
}
export function segmentTranscript({text,source}){
 if(typeof text!=='string'||!text.trim()||text.length>1000000)throw new Error('Transcript must contain 1–1000000 characters');
 if(typeof source!=='string'||!source.trim())throw new Error('Transcript source required');
 const digest=createHash('sha256').update(source+'\n'+text).digest('hex');
 const segments=[];
 for(let start=0;start<text.length;start+=1600)segments.push({text:text.slice(start,start+1600),source:`${source}#segment=${segments.length+1}`,digest});
 return segments;
}
