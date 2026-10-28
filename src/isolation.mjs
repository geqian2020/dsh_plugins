import path from 'node:path';
import {homedir} from 'node:os';
export const PRESET = 'book-companion';
export const BOOK_WORKSPACE=path.resolve(process.env.DSH_HOME??path.join(homedir(),'.dsh'),'book-companion/workspace');
export function createPolicy({excludeAgentPresets=[PRESET], excludeWorkspaceRoots=[BOOK_WORKSPACE]}={}) {
  if (!Array.isArray(excludeAgentPresets) || excludeAgentPresets.some(x=>typeof x!=='string'||!x)) throw new Error('Invalid excluded presets');
  if (!Array.isArray(excludeWorkspaceRoots) || excludeWorkspaceRoots.some(x=>typeof x!=='string'||!path.isAbsolute(x))) throw new Error('Excluded roots must be absolute');
  const presets=new Set(excludeAgentPresets);
  const roots=excludeWorkspaceRoots.map(x=>path.resolve(x));
  return session => {
    const h=session?.header;
    if(presets.has(h?.agentPreset)) return true;
    if(typeof h?.cwd!=='string') return false;
    return roots.some(root=>{const rel=path.relative(root,path.resolve(h.cwd));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));});
  };
}
export function assertManagedIdentity(session,isExcluded){
  if(isExcluded(session)&&session?.header?.agentPreset!==PRESET)throw new Error('Protected book workspace requires book-companion preset; unsafe fork refused');
}
export function requireBook(agent) {
  if(agent?.session?.header?.agentPreset!==PRESET) throw new Error('Book companion identity required');
  return agent.session;
}
export function memoryToolGuard(isExcluded) {
  return exec => isExcluded(exec.agent?.session) && exec.name.startsWith('mcp__openviking__') ? 'Book companion cannot access main memory' : undefined;
}
