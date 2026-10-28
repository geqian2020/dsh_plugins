import fs from 'node:fs';
import path from 'node:path';
export function lockBookControls(harness){
 const blocked=new Set(['updateAgentPreset','switchWorkspace','switchConversationWorkspace','clearConversationWorkspace','bindWorkspaceSession','executeCommand']);
 return new Proxy(harness,{get(target,key){if(blocked.has(key))return ()=>{throw new Error('书童入口的身份和工作目录已锁定。');};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
}
// Host-only adapter. No model may choose the route registry, bot id or preset.
export function lockBookHarness(harness,{botId,workspace,registryPath,resolveLiveSession=()=>undefined}){
 if(!botId||!path.isAbsolute(workspace)||!path.isAbsolute(registryPath))throw new Error('Invalid book route settings');
 let sessions={};
 if(fs.existsSync(registryPath))sessions=JSON.parse(fs.readFileSync(registryPath,'utf8'));
 function check(id){
  const row=sessions[id],live=resolveLiveSession(id);
  if(!row||row.botId!==botId||row.preset!=='book-companion'||row.workspace!==workspace)throw new Error('书童不能使用未绑定的会话。');
  if(live&&(live.header.agentPreset!=='book-companion'||path.resolve(live.header.cwd??'')!==workspace))throw new Error('书童会话身份不匹配，已停止。');
 }
 const blocked=new Set(['rpc','adoptWorkspaceSession','bindWorkspaceSession','updateAgentPreset','switchWorkspace','switchConversationWorkspace','clearConversationWorkspace','executeCommand','respondInteraction']);
 const sessionMethods=new Set(['ask','readSessionHistory','renameSession','getSessionModels','getSessionPermissions','selectSessionModel','isSessionRunning','hasActiveTurn','stopActiveTurn','stopDeferredTurn','steerActiveTurn','watchInteractions']);
 return new Proxy(harness,{get(target,key){
  if(blocked.has(key))return ()=>{throw new Error('书童入口的身份和工作目录已锁定。');};
  if(key==='listWorkspaceSessions')return async()=>({items:[]});
  if(key==='createSession')return async(options={})=>{
   const id=await target.createSession({...options,agentPreset:'book-companion',workspace});
   const live=resolveLiveSession(id);
   if(live&&(live.header.agentPreset!=='book-companion'||path.resolve(live.header.cwd??'')!==workspace))throw new Error('新建书童会话身份不匹配。');
   sessions[id]={botId,preset:'book-companion',workspace};
   fs.mkdirSync(path.dirname(registryPath),{recursive:true});
   const temp=registryPath+'.tmp';fs.writeFileSync(temp,JSON.stringify(sessions,null,2));fs.renameSync(temp,registryPath);return id;
  };
  if(key==='sessionExists')return async(id,...args)=>{check(id);return target.sessionExists(id,...args);};
  if(sessionMethods.has(key))return (id,...args)=>{check(id);return target[key](id,...args);};
  const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;
 }});
}
