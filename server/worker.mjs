import path from 'node:path';
import fs from 'node:fs/promises';
import {config} from './config.mjs';
import {Store,uid,now,parse} from './store.mjs';
import {fetchPublic} from './security.mjs';
import {saveBuffer,blobPath} from './files.mjs';
import {extractWeb,extractFile} from './extract.mjs';
import {createBackup,inspectBackup} from './backup.mjs';
import {Hot,parseFeedItems} from './hot.mjs';
import {recognize,candidates} from './ocr.mjs';
import {Analytics} from './analytics.mjs';
import {spawn} from 'node:child_process';
import {runModel} from './model.mjs';
import {importVideos,runChat} from './studio.mjs';
import {runTranscription,importVideoLink} from './transcription.mjs';
import {archiveFiles} from './workspace.mjs';
import {collectPublicComments} from './discovery.mjs';
import {collectNewsImage} from './discovery-media.mjs';
const cfg=config(),store=new Store(cfg.db),hot=new Hot(store),owner=uid();let lastSchedule=0;let stop=false,active=null;
process.on('SIGTERM',()=>{stop=true;active?.abort();});process.on('SIGINT',()=>{stop=true;active?.abort();});
if(process.send){process.on('disconnect',()=>{stop=true;active?.abort();});}
function claim(){return store.transaction(()=>{store.db.prepare("UPDATE jobs SET status='排队',stage='服务恢复，重新排队',owner=NULL,lease_until=NULL WHERE status='处理中' AND (lease_until IS NULL OR lease_until<?)").run(now());const j=store.db.prepare("SELECT * FROM jobs WHERE status IN ('排队','等待重试') AND next_at<=? ORDER BY created_at LIMIT 1").get(now());if(!j)return null;store.db.prepare("UPDATE jobs SET status='处理中',stage='准备读取',attempts=attempts+1,owner=?,lease_until=?,updated_at=? WHERE id=?").run(owner,new Date(Date.now()+15000).toISOString(),now(),j.id);return store.row('jobs',j.id);});}
function stage(id,s){store.db.prepare("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND status='处理中'").run(s,now(),id);}
async function execute(job,signal){const input=parse(job.input);if(job.kind==='backup'){stage(job.id,'创建一致数据库快照并校验原文件');return {status:'成功',result:await createBackup(store,cfg.dir)};}if(job.kind==='restore-preview'){stage(job.id,'逐文件校验备份并检查数据库关系');const result=await inspectBackup(path.join(cfg.dir,'staging',input.filename),path.join(cfg.dir,'restored'));return {status:'成功',result:{...result,manifest:{...result.manifest,files:undefined},token:uid()}};}
if(job.kind==='workspace-archive'){const r=await archiveFiles(store,cfg.dir,undefined,signal,s=>stage(job.id,s));return {status:r.failed?'部分完成':'成功',result:r};}
if(job.kind==='studio-import'){const r=await importVideos(store,cfg.dir,input.items,signal,s=>stage(job.id,s));return {status:r.failed?'部分完成':'成功',result:r};}
if(job.kind==='transcribe')return runTranscription(store,cfg.dir,input,signal,s=>stage(job.id,s));
if(job.kind==='video-link')return importVideoLink(store,cfg.dir,input,signal,s=>stage(job.id,s));
if(job.kind==='news-image'){stage(job.id,'读取来源封面并保存完整原图');const media=await collectNewsImage(store,cfg.dir,input,{signal});return {status:media.hash?'成功':'部分完成',result:media};}
if(job.kind==='comments-fetch'){stage(job.id,'读取公开评论（不使用登录凭据）');return collectPublicComments(store,cfg.dir,input,signal);}
if(job.kind==='studio-chat'){stage(job.id,'Codex 正在思考与创作');return runChat(store,cfg.dir,input,signal);}
if(job.kind==='feed-fetch'){const feed=store.row('feeds',input.feedId);stage(job.id,'校验公共地址并读取订阅源');let response;try{response=await fetchPublic(feed.url,{signal,maxBytes:5*1024*1024});}catch(e){hot.feedFailed(feed.id,job.id,e.message,!e.retryable||job.attempts>=job.max_attempts);throw e;}stage(job.id,'保存订阅原始响应');const raw=await saveBuffer(store,cfg.dir,response.buffer,'feed.xml');stage(job.id,'逐条去重并聚合事件');let parsed;try{parsed=parseFeedItems(response.buffer);}catch(e){hot.feedFailed(feed.id,job.id,e.message,true);throw e;}return {status:'成功',result:hot.ingest(feed.id,job.id,parsed,raw.hash)};}
if(job.kind==='daily-brief'){stage(job.id,'按筛选条件生成当日简报');const r=hot.makeBrief(input.day,input.scheduledFor);return {status:'成功',result:{briefId:r.brief.id,day:input.day,duplicate:r.duplicate}};}
if(job.kind==='ocr'){const shot=store.db.prepare('SELECT * FROM data_screenshots WHERE id=?').get(input.screenshotId);if(!shot)throw new Error('截图不存在');store.db.prepare("UPDATE data_screenshots SET status='识别中',updated_at=? WHERE id=?").run(now(),shot.id);stage(job.id,'本机文字识别（不联网）');try{const r=await recognize(blobPath(cfg.dir,shot.blob_hash),cfg.dir);const c=candidates(r.lines,new Analytics(store).defs());store.db.prepare("UPDATE data_screenshots SET status='已识别',ocr=?,error='',updated_at=? WHERE id=?").run(JSON.stringify({...r,candidates:c}),now(),shot.id);return {status:'成功',result:{screenshotId:shot.id,candidates:c.length,ms:r.ms}};}catch(e){store.db.prepare("UPDATE data_screenshots SET status='识别失败',error=?,updated_at=? WHERE id=?").run(String(e.message).slice(0,500),now(),shot.id);throw e;}}
if(job.kind==='model-call'){stage(job.id,'调用已配置的模型并校验引用');return await runModel(store,cfg.dir,input.callId,signal);}
let extracted,blobHash=null,filename='',rawMeta={};if(job.kind==='fetch'){stage(job.id,'校验公共地址并读取来源');const response=await fetchPublic(input.url,{signal});stage(job.id,'保存收到的原始文件');const raw=await saveBuffer(store,cfg.dir,response.buffer,/rss|xml/i.test(response.mime)?'source.xml':/html/i.test(response.mime)?'source.html':'source.txt');blobHash=raw.hash;filename=raw.name;rawMeta={finalUrl:response.url,redirects:response.chain,http:response.headers};stage(job.id,'提取实际可读原文');try{extracted=extractWeb(response.buffer,response.mime,response.url);}catch(e){extracted={body:'',locations:[],status:'部分完成',error:e.message,method:'来源链接与响应原件保存；正文待补',metadata:{}};}}
else if(job.kind==='parse-file'){blobHash=input.hash;filename=input.name;stage(job.id,'读取原文件，提取文字或媒体参数');try{extracted=await extractFile(blobPath(cfg.dir,input.hash),input.name,input.mime);}catch(e){extracted={body:'',locations:[],status:'部分完成',error:e.message,method:'原件已保存，文字解析待补',metadata:{}};}}
else throw new Error('未知任务类型');
if(signal.aborted||store.row('jobs',job.id).status==='已取消')throw new Error('任务已取消');
return store.transaction(()=>{const s=store.row('sources',job.source_id),m=parse(s.metadata);for(const key of ['author','sourceDate'])if(!m[key]&&extracted.metadata[key])m[key]=String(extracted.metadata[key]).slice(0,1000);const title=job.kind==='fetch'&&(!input.customTitle)&&extracted.title?extracted.title.slice(0,300):s.title;store.db.prepare('UPDATE sources SET title=?,metadata=?,updated_at=? WHERE id=?').run(title,JSON.stringify(m),now(),s.id);const v=store.addVersion(s.id,{body:extracted.body,blobHash,filename,method:extracted.method,status:extracted.status,error:extracted.error,locations:extracted.locations,metadata:{...extracted.metadata,...rawMeta}});return {status:extracted.status,result:{sourceId:s.id,versionId:v.id,originalSaved:!!blobHash,textCharacters:extracted.body.length}};});}
while(!stop){if(Date.now()-lastSchedule>30000){lastSchedule=Date.now();try{hot.schedule();}catch(e){console.error('调度检查失败：'+e.message);}}let job;try{job=claim();}catch(e){console.error('任务存储暂不可用：'+e.message);await new Promise(r=>setTimeout(r,1000));continue;}if(!job){await new Promise(r=>setTimeout(r,400));continue;}active=new AbortController();const awake=process.platform==='darwin'?spawn('/usr/bin/caffeinate',['-i','-w',String(process.pid)],{stdio:'ignore'}):null;const timeout=setTimeout(()=>active?.abort(),['studio-import','transcribe','workspace-archive','backup','restore-preview'].includes(job.kind)?2100000:120000);const heartbeat=setInterval(()=>{try{const current=store.row('jobs',job.id);if(current.status==='已取消'){active?.abort();return;}store.db.prepare('UPDATE jobs SET lease_until=?,updated_at=? WHERE id=? AND owner=?').run(new Date(Date.now()+15000).toISOString(),now(),job.id,owner);}catch{active?.abort();}},1000);
try{const result=await execute(job,active.signal);if(store.row('jobs',job.id).status!=='已取消')store.db.prepare("UPDATE jobs SET status=?,stage='处理完成',result=?,error='',owner=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(result.status,JSON.stringify(result.result),now(),job.id);}
catch(e){if(store.row('jobs',job.id).status!=='已取消'){if(stop)store.db.prepare("UPDATE jobs SET status='排队',stage='服务停止，等待恢复',owner=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now(),job.id);else if(e.retryable&&job.attempts<job.max_attempts)store.db.prepare("UPDATE jobs SET status='等待重试',stage='来源暂不可用，限次重试',error=?,next_at=?,owner=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(e.message,new Date(Date.now()+job.attempts*30000).toISOString(),now(),job.id);else store.transaction(()=>{if(job.source_id&&!['transcribe','studio-chat'].includes(job.kind))store.addVersion(job.source_id,{status:'失败',method:'保留提交内容与出处',error:e.message});store.db.prepare("UPDATE jobs SET status='失败',stage='等待人工处理',error=?,owner=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(e.message,now(),job.id);});}}
finally{awake?.kill();clearTimeout(timeout);clearInterval(heartbeat);active=null;}}
store.close();
