export function qqVoiceText(message){
 const attachments=message?.attachments??[];
 const audio=attachments.filter(a=>String(a.content_type??a.contentType??'').startsWith('audio/'));
 if(audio.length===0)return '';
 const parts=audio.map(a=>typeof a.asr_refer_text==='string'?a.asr_refer_text.trim():'').filter(Boolean);
 if(parts.length!==audio.length)return '[收到语音，但没有完整的语音识别文本；不能猜测语音内容。]'+(parts.length?'\n已识别部分：'+parts.join('\n'):'');
 return '[QQ 语音识别文本，可能存在识别错误]\n'+parts.join('\n');
}
