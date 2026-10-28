import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'vendor/dsh-im-source/dsh-im-main/src/channels/qq');
const file=path.join(dir,'qq-bridge.mjs');let source=fs.readFileSync(file,'utf8');
if(!source.includes("from './voice-text.mjs'")){
 if(!source.includes('content: safeText(message),'))throw new Error('QQ inbound shape changed; patch refused');
 source="import { qqVoiceText } from './voice-text.mjs';\n"+source.replace('content: safeText(message),',"content: [safeText(message), qqVoiceText(message)].filter(Boolean).join('\\n'),");
 fs.writeFileSync(file,source);
}fs.copyFileSync(path.join(root,'patches/dsh-im/voice-text.mjs'),path.join(dir,'voice-text.mjs'));
console.log('QQ platform-ASR adapter prepared (external ASR fallback not yet configured)');
