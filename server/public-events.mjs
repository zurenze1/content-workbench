import {uid,now,text,hash} from './store.mjs';
import {sourceUrl} from './security.mjs';
import {saveBuffer} from './files.mjs';
export const EVENT_STATES=['已官宣','报道待核验','待核验','已取消','已延期','已举行（已核验）'];
export function normalizeEvent(b){
  const eventDate=text(b.eventDate,10,true);if(!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)||new Date(eventDate+'T12:00:00Z').toISOString().slice(0,10)!==eventDate)throw new Error('活动日期无效');
  const zone=text(b.timezone,80)||'Asia/Shanghai';try{new Intl.DateTimeFormat('zh-CN',{timeZone:zone});}catch{throw new Error('活动时区无效');}
  const status=text(b.status,40)||'待核验';if(!EVENT_STATES.includes(status))throw new Error('活动状态无效');
  const title=text(b.title,300,true),subject=text(b.subject,300,true),url=sourceUrl(text(b.announcementUrl,4000,true)),evidence=text(b.evidence,10000,true),sourceType=text(b.sourceType,40)||'待核验';
  if(status==='已官宣'&&sourceType!=='当事方官方公告')throw new Error('标注已官宣需要当事方官方公告依据');
  return {eventId:text(b.eventId,100),title,subject,eventDate,timeLabel:text(b.timeLabel,100)||'具体时间待公布',timezone:zone,location:text(b.location,300)||'地点待公布',kind:text(b.kind,80)||'公开活动',status,announcementUrl:url,announcedAt:text(b.announcedAt,100),evidence,sourceType};
}
export async function saveEvent(store,dir,body,{rawHash=null,id=null}={}){
  const e=normalizeEvent(body),key=hash(e.subject+'|'+e.title+'|'+e.eventDate+'|'+e.announcementUrl),old=id?store.db.prepare('SELECT * FROM public_events WHERE id=?').get(id):store.db.prepare('SELECT * FROM public_events WHERE dedup_key=?').get(key);
  if(id&&!old)throw new Error('活动不存在');
  const raw=rawHash?{hash:rawHash}:await saveBuffer(store,dir,Buffer.from(JSON.stringify(e,null,2)),'活动公告核对记录.json');
  return store.transaction(()=>{const source=old?.source_id?{source:store.row('sources',old.source_id)}:store.createSource({title:e.subject+' · '+e.title+' · 公告',url:e.announcementUrl,kind:'文章',rights:'仅作参考',state:'待核对',tags:['活动公告',e.subject],notes:'公开日程依据；活动计划不代表实际已出席。'},'event-announcement:'+key);
    store.addVersion(source.source.id,{body:e.evidence,blobHash:raw.hash,filename:'公告核对原始记录.json',method:'公开公告核对摘要（不是完整网页原文）',metadata:{sourceType:e.sourceType,announcedAt:e.announcedAt,eventDate:e.eventDate}});
    const eventId=old?.id||uid();if(old)store.db.prepare('UPDATE public_events SET dedup_key=?,title=?,subject=?,event_date=?,time_label=?,timezone=?,location=?,kind=?,status=?,announcement_url=?,announced_at=?,evidence=?,updated_at=? WHERE id=?').run(key,e.title,e.subject,e.eventDate,e.timeLabel,e.timezone,e.location,e.kind,e.status,e.announcementUrl,e.announcedAt,e.evidence,now(),eventId);
    else store.db.prepare('INSERT INTO public_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(eventId,key,e.title,e.subject,e.eventDate,e.timeLabel,e.timezone,e.location,e.kind,e.status,e.announcementUrl,e.announcedAt,e.evidence,source.source.id,null,now());
    store.db.prepare('INSERT INTO public_event_versions VALUES(?,?,?,?,?)').run(uid(),eventId,JSON.stringify(e),raw.hash,now());return store.db.prepare('SELECT * FROM public_events WHERE id=?').get(eventId);});
}
export function events(store,q={}){return store.db.prepare('SELECT * FROM public_events ORDER BY event_date,time_label LIMIT 3000').all().filter(e=>(!q.from||e.event_date>=q.from)&&(!q.to||e.event_date<=q.to)&&(!q.q||(e.subject+' '+e.title+' '+e.location).toLowerCase().includes(String(q.q).toLowerCase())));}
export function registerEvents(app,store,cfg){
  app.get('/api/public-events',async req=>events(store,req.query));
  app.get('/api/public-events/:id',async req=>({event:store.db.prepare('SELECT * FROM public_events WHERE id=?').get(req.params.id),versions:store.db.prepare('SELECT * FROM public_event_versions WHERE event_id=? ORDER BY created_at DESC,rowid DESC').all(req.params.id).map(v=>({...v,payload:JSON.parse(v.payload)}))}));
  app.post('/api/public-events',async req=>saveEvent(store,cfg.dir,req.body));
  app.patch('/api/public-events/:id',async req=>saveEvent(store,cfg.dir,req.body,{id:req.params.id}));
  app.post('/api/public-events/:id/topic',async req=>{const e=store.db.prepare('SELECT * FROM public_events WHERE id=?').get(req.params.id);if(!e)throw new Error('活动不存在');if(e.topic_id)return {topic:store.row('topics',e.topic_id),existing:true};return store.transaction(()=>{const t=store.topic({title:e.subject+' · '+e.title,brief:`活动计划：${e.event_date} ${e.time_label} ${e.timezone}\n${e.location}\n状态：${e.status}\n公开来源：${e.announcement_url}\n实际出席与后续变化待复核。`});store.link(t.id,e.source_id);store.db.prepare('UPDATE public_events SET topic_id=? WHERE id=?').run(t.id,e.id);return {topic:t};});});
}
