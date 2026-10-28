import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const im=path.join(root,'vendor/dsh-im-source/dsh-im-main');
const file=path.join(im,'plugin-src/host/channels/qq/production.mjs');
let source=fs.readFileSync(file,'utf8');
if(source.includes('lockBookHarness')){
 source=source.replace("import { lockBookHarness }", "import { lockBookHarness, lockBookControls }").replace('harness: workspaceScope.harness,','harness: bookRoute ? lockBookControls(workspaceScope.harness) : workspaceScope.harness,');
 fs.writeFileSync(file,source);
 fs.copyFileSync(path.join(root,'patches/dsh-im/book-route.mjs'),path.join(im,'plugin-src/host/channels/qq/book-route.mjs'));
 console.log('Refreshed existing QQ route source patch');process.exit(0);
}
const hash=crypto.createHash('sha256').update(source).digest('hex');
const marker='      const workspaceScope = createBotWorkspaceScope(harness, {';
if(!source.includes(marker))throw new Error('QQ production source changed; patch refused');
source="import { lockBookHarness, lockBookControls } from './book-route.mjs';\n"+source.replace(marker,`      const bookRoute = config.bookCompanionBots?.[botId];
      const routedHarness = bookRoute ? lockBookHarness(harness, {
        botId,
        workspace: resolve(bookRoute.workspace),
        registryPath: resolve(paths.bots, botId, 'book-sessions.json'),
        resolveLiveSession: id => ctx.get('sessions')?.get(id),
      }) : harness;
      const workspaceScope = createBotWorkspaceScope(routedHarness, {`);
source=source.replace('harness: workspaceScope.harness,','harness: bookRoute ? lockBookControls(workspaceScope.harness) : workspaceScope.harness,');
fs.writeFileSync(file,source);
fs.copyFileSync(path.join(root,'patches/dsh-im/book-route.mjs'),path.join(im,'plugin-src/host/channels/qq/book-route.mjs'));
const pkg=JSON.parse(fs.readFileSync(path.join(im,'package.json')));
fs.writeFileSync(path.join(root,'artifacts/im-patch.json'),JSON.stringify({package:pkg.name,version:pkg.version,compatibility:pkg.dsh.compatibility,originalProductionSha256:hash,status:'source-patched-build-and-live-test-pending'},null,2));
console.log('Patched downloaded QQ source; live profile unchanged');
