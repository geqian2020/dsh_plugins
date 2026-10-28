import {test}from 'node:test';import assert from 'node:assert/strict';
import {qqVoiceText}from '../patches/dsh-im/voice-text.mjs';
test('voice uses platform transcript and reports missing recognition honestly',()=>{
 assert.equal(qqVoiceText({attachments:[]}), '');
 assert.match(qqVoiceText({attachments:[{content_type:'audio/silk',asr_refer_text:'我对史记的感想'}]}),/我对史记的感想/);
 assert.match(qqVoiceText({attachments:[{content_type:'audio/silk'}]}),/不能猜测/);
 assert.match(qqVoiceText({attachments:[{content_type:'audio/silk',asr_refer_text:'一部分'},{content_type:'audio/silk'}]}),/已识别部分/);
});
