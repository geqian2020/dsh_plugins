import { DatabaseSync } from 'node:sqlite';
import { randomUUID,createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { requireBook } from './isolation.mjs';
export class BookStore {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(id UNINDEXED,text);
      CREATE TABLE IF NOT EXISTS imports(digest TEXT PRIMARY KEY,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tombstones(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,question TEXT NOT NULL,user_view TEXT NOT NULL,assistant_view TEXT NOT NULL,evidence TEXT NOT NULL,resolved INTEGER NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outreach(slot TEXT PRIMARY KEY,session_id TEXT NOT NULL,article_url TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
      PRAGMA user_version=2;`);
  }
  add(agent,{kind,text,source}) {
    const session=requireBook(agent);
    if(!['user-view','assistant-view','material','preference-hypothesis','assistant-interest'].includes(kind))throw new Error('Invalid note kind');
    if(typeof text!=='string'||!text.trim()||text.length>100000)throw new Error('Invalid note text');
    if(typeof source!=='string'||!source.trim())throw new Error('Source is required');
    const row={id:randomUUID(),session_id:session.header.id,kind,text,source,created_at:new Date().toISOString()};
    this.db.exec('BEGIN');try {
      this.db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?)').run(...Object.values(row));
      this.db.prepare('INSERT INTO notes_fts(id,text) VALUES (?,?)').run(row.id,text);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}return row;
  }
  search(agent,query) {
    requireBook(agent);
    if(typeof query!=='string'||query.length>500)throw new Error('Invalid query');
    const term=query.trim();
    if(!term)return [];
    // Literal substring supports Chinese terms without relying on ASCII token segmentation.
    const exact=this.db.prepare('SELECT * FROM notes WHERE instr(text,?)>0 ORDER BY created_at DESC LIMIT 12').all(term);
    if(exact.length>0)return exact.map(r=>({...r,text:r.text.slice(0,4000)}));
    // 转写有错字时（宫崎骏→宫崎俊），退化成二元组匹配，按命中数排序
    const chars=[...term];
    if(chars.length<3)return [];
    const grams=[...new Set(chars.slice(0,-1).map((c,i)=>c+chars[i+1]))];
    const rows=this.db.prepare(`SELECT * FROM notes WHERE ${grams.map(()=>'instr(text,?)>0').join(' OR ')} ORDER BY created_at DESC LIMIT 60`).all(...grams);
    const minScore=Math.max(1,Math.ceil(grams.length/2));
    return rows.map(r=>({...r,score:grams.filter(g=>r.text.includes(g)).length}))
      .filter(r=>r.score>=minScore)
      .sort((a,b)=>b.score-a.score||(a.created_at<b.created_at?1:-1))
      .slice(0,12)
      .map(({score,...r})=>({...r,text:r.text.slice(0,4000),match:'fuzzy'}));
  }
  capture(session,event){
    requireBook({session});
    const message=event.type==='user/message'?event.data:event.type==='assistant/message'?event.data?.message:null;
    if(!message||!['user','assistant'].includes(message.role))return;
    if(message.role==='user'&&message.source?.kind&&message.source.kind!=='user')return;
    const text=(message.content??[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
    if(!text.trim())return;
    if(!Number.isSafeInteger(event.seq))throw new Error('Capture event requires durable sequence');
    const source=`session:${session.header.id}/event:${event.seq}`;
    const id=createHash('sha256').update(source).digest('hex');
    if(this.db.prepare('SELECT 1 FROM tombstones WHERE id=?').get(id)||this.db.prepare('SELECT 1 FROM notes WHERE id=?').get(id))return;
    const created=Number.isFinite(event.time)?new Date(event.time).toISOString():new Date().toISOString();
    this.db.exec('BEGIN');try{
      this.db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?)').run(id,session.header.id,message.role==='user'?'user-utterance':'assistant-utterance',text,source,created);
      this.db.prepare('INSERT INTO notes_fts(id,text) VALUES (?,?)').run(id,text);this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  remove(agent,id){requireBook(agent);this.db.exec('BEGIN');try{this.db.prepare('DELETE FROM notes WHERE id=?').run(id);this.db.prepare('DELETE FROM notes_fts WHERE id=?').run(id);this.db.prepare('INSERT OR IGNORE INTO tombstones VALUES (?)').run(id);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
  importTranscript(agent,segments){
    requireBook(agent);const digest=segments[0]?.digest;
    if(!digest)throw new Error('Empty transcript');
    if(this.db.prepare('SELECT 1 FROM imports WHERE digest=?').get(digest))return {status:'already-imported',digest};
    // Savepoints make all segments and the deduplication marker atomic.
    this.db.exec('SAVEPOINT import_transcript');
    try{
      const rows=[];
      for(const segment of segments){
        const row={id:randomUUID(),session_id:agent.session.header.id,kind:'material',text:segment.text,source:segment.source,created_at:new Date().toISOString()};
        this.db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?)').run(...Object.values(row));
        this.db.prepare('INSERT INTO notes_fts(id,text) VALUES (?,?)').run(row.id,row.text);rows.push(row.id);
      }
      this.db.prepare('INSERT INTO imports VALUES (?,?)').run(digest,new Date().toISOString());
      this.db.exec('RELEASE import_transcript');return {status:'transcript-ready',digest,segments:rows.length};
    }catch(e){this.db.exec('ROLLBACK TO import_transcript');this.db.exec('RELEASE import_transcript');throw e;}
  }
  review(agent,{since,until}){
    requireBook(agent);
    if(!Number.isFinite(Date.parse(since))||!Number.isFinite(Date.parse(until))||Date.parse(since)>=Date.parse(until))throw new Error('Invalid review dates');
    const rows=this.db.prepare('SELECT * FROM notes WHERE created_at>=? AND created_at<? ORDER BY created_at LIMIT 201').all(new Date(since).toISOString(),new Date(until).toISOString());
    return {truncated:rows.length>200,records:rows.slice(0,200).map(r=>({...r,text:r.text.slice(0,2000),textTruncated:r.text.length>2000})),openThreads:this.thread(agent,{action:'list'})};
  }
  thread(agent,{action,id,question,userView,assistantView,evidence,resolved}={}){
    requireBook(agent);
    if(action==='list')return this.db.prepare('SELECT id,question,user_view AS userView,assistant_view AS assistantView,evidence,resolved,updated_at AS updatedAt FROM threads WHERE resolved=0 ORDER BY updated_at DESC LIMIT 20').all();
    if(action==='delete'){
      if(typeof id!=='string'||!id)throw new Error('Thread id required');
      const result=this.db.prepare('DELETE FROM threads WHERE id=?').run(id);return {deleted:result.changes>0,id};
    }
    if(action!=='save')throw new Error('Thread action must be list/save/delete');
    const existing=id===undefined?undefined:this.db.prepare('SELECT * FROM threads WHERE id=?').get(id);
    if(id!==undefined&&(typeof id!=='string'||!existing))throw new Error('Unknown thread id');
    question??=existing?.question;userView??=existing?.user_view??'';assistantView??=existing?.assistant_view??'';evidence??=existing?.evidence??'';resolved??=Boolean(existing?.resolved);
    for(const [field,value]of Object.entries({question,userView,assistantView,evidence}))if(typeof value!=='string'||value.length>6000)throw new Error('Invalid thread '+field);
    if(!question.trim()||!evidence.trim())throw new Error('Question and evidence are required');
    if(typeof resolved!=='boolean')throw new Error('resolved must be boolean');
    const row={id:id??randomUUID(),question,userView,assistantView,evidence,resolved,updatedAt:new Date().toISOString()};
    this.db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET question=excluded.question,user_view=excluded.user_view,assistant_view=excluded.assistant_view,evidence=excluded.evidence,resolved=excluded.resolved,updated_at=excluded.updated_at').run(row.id,question,userView,assistantView,evidence,Number(resolved),row.updatedAt);
    return row;
  }
  claimOutreach(agent,{slot,url}){
    const session=requireBook(agent);
    if(this.db.prepare('SELECT 1 FROM outreach WHERE article_url=?').get(url))return false;
    return this.db.prepare('INSERT OR IGNORE INTO outreach VALUES (?,?,?,?,?)').run(slot,session.id??session.header.id,url,'pending',new Date().toISOString()).changes===1;
  }
  interests(agent){requireBook(agent);return this.db.prepare("SELECT id,text,source FROM notes WHERE kind='assistant-interest' ORDER BY created_at DESC LIMIT 8").all();}
  finishOutreach(slot,status){
    if(!['submitted','failed'].includes(status))throw new Error('Invalid outreach state');
    this.db.prepare('UPDATE outreach SET status=? WHERE slot=?').run(status,slot);
  }
  close(){this.db.close();}
}
