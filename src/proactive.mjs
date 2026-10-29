// Model-free scheduling: only a read article with a matching open question can
// trigger a continuation. Delivery here means submission to a DSH session, not QQ.
export function createProactiveReader({store,reader,lookupAgent,makeMessage,config={},now=()=>Date.now()}){
  let target=null,running=false,closed=false;const abort=new AbortController();
  const parts=time=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:config.timeZone??'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(time).map(p=>[p.type,p.value]));
  return {
    observe(session,event){if(event.type==='user/message'&&event.data?.source?.kind==='user')target={id:session.id??session.header.id,at:now()};},
    close(){closed=true;abort.abort();},
    async tick(){
      if(closed||!config.enabled||!target||running)return {status:'idle'};
      const p=parts(now()),hour=Number(p.hour);
      if(hour<8||hour>=22||now()-target.at<(config.idleMinutes??30)*60000)return {status:'quiet'};
      const agent=lookupAgent(target.id);
      if(!agent||agent.session.header.agentPreset!=='book-companion'||agent.status!=='idle')return {status:'busy-or-unavailable'};
      running=true;
      try{
        const open=store.thread(agent,{action:'list'})[0],interest=store.interests(agent)[0];
        const own=interest&&(!open||Number(p.day)%2===1);
        const thread=own?{question:interest.text,assistantView:interest.text,evidence:interest.source,origin:'assistant-interest',userView:'尚未据此推断用户兴趣，请检索实际交流寻找关联'}:open;
        if(!thread)return {status:'no-open-question-or-interest'};
        const result=await reader.discover({query:thread.question,signal:abort.signal});
        const candidate=result.items.find(i=>i.matchedTerms.length>0);if(!candidate)return {status:'no-relevant-material'};
        const slot=`${p.year}-${p.month}-${p.day}`;
        // Reserve before network work; uncertain/interrupted jobs are not replayed automatically.
        if(!store.claimOutreach(agent,{slot,url:candidate.url}))return {status:'already-considered'};
        try{
          const article=await reader.readArticle({url:candidate.url,store,agent,signal:abort.signal});
          if(closed||agent.status!=='idle') {store.finishOutreach(slot,'failed');return {status:'conversation-became-busy'};}
          agent.followup(makeMessage({content:[{type:'text',text:JSON.stringify({task:'主动阅读后继续与用户交流；这是内部任务，不是用户的新观点。先检索上下文，给出自己的判断，说明与旧问题的具体联系，允许保留分歧，避免泛泛推送。',thread,article})}],source:{kind:'plugin:book-companion',form:'proactive-reading'}}));
          store.finishOutreach(slot,'submitted');return {status:'submitted-to-dsh-session',url:candidate.url};
        }catch(error){store.finishOutreach(slot,'failed');throw error;}
      }finally{running=false;}
    }
  };
}
