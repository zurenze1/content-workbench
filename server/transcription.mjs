import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {uid,now,text,hash,parse} from './store.mjs';
import {saveBuffer,saveBlob,blobPath} from './files.mjs';
import {sourceUrl,fetchPublic} from './security.mjs';
const exec=promisify(execFile),root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const installed={python:path.join(os.homedir(),'.codex/skills/funasr-transcribe/venv/bin/python'),ffmpeg:'/Applications/Remotion与HyperFrames/bin/ffmpeg',probe:'/Applications/Remotion与HyperFrames/bin/ffprobe',cache:path.join(os.homedir(),'.codex/skills/funasr-transcribe/.modelscope/models/iic')};
function runtime(){return {python:process.env.WORKBENCH_ASR_PYTHON||installed.python,ffmpeg:process.env.WORKBENCH_FFMPEG||installed.ffmpeg,probe:process.env.WORKBENCH_FFPROBE||installed.probe,cache:process.env.WORKBENCH_ASR_CACHE||installed.cache};}
export function transcriptionStatus(){const r=runtime();const enabled=[r.python,r.ffmpeg,r.probe,...['SenseVoiceSmall','speech_fsmn_vad_zh-cn-16k-common-pytorch','punc_ct-transformer_zh-cn-common-vocab272727-pytorch'].map(n=>path.join(r.cache,n,'model.pt'))].every(p=>fs.existsSync(p));return {enabled,state:enabled?'本机转写已就绪 · 不上传音视频':'本机语音识别环境未就绪',engine:'SenseVoiceSmall',timestamps:false};}
export function queueTranscription(store,sourceId){
  if(!transcriptionStatus().enabled)throw new Error('本机语音识别环境未就绪，请在设置查看状态');
  const s=store.sourceDetail(sourceId),v=s.versions.find(v=>v.blob_hash&&/\.(mp4|mov|webm|m4v|m4a|mp3|wav|aac|flac|ogg)$/i.test(v.filename));if(!v)throw new Error('没有取得可转写的原视频或音频，请先上传原文件');
  const existing=store.db.prepare("SELECT t.*,j.status job_status FROM transcripts t JOIN jobs j ON j.id=t.job_id WHERE t.source_id=? AND t.blob_hash=? AND (j.status IN ('排队','处理中','等待重试') OR t.status='已生成') ORDER BY t.created_at DESC LIMIT 1").get(s.id,v.blob_hash);if(existing)return {id:existing.id,jobId:existing.job_id,duplicate:true};
  return store.transaction(()=>{const id=uid(),job=store.job('transcribe',{transcriptId:id},s.id);store.db.prepare('INSERT INTO transcripts VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,s.id,v.id,v.blob_hash,job.id,'排队',null,'',now(),now());return {id,jobId:job.id,duplicate:false};});
}
export function transcriptList(store,q={}){return store.db.prepare('SELECT t.*,s.title,s.url,j.status job_status,j.stage,j.error job_error FROM transcripts t JOIN sources s ON s.id=t.source_id LEFT JOIN jobs j ON j.id=t.job_id ORDER BY t.created_at DESC LIMIT 300').all().filter(t=>!q.q||(t.title+' '+t.url).includes(q.q)).map(t=>({...t,status:t.status==='已生成'?t.status:t.job_status||t.status,error:t.job_error||t.error}));}
export async function runTranscription(store,dir,input,signal,stage=()=>{}){
  const t=store.db.prepare('SELECT * FROM transcripts WHERE id=?').get(input.transcriptId);if(!t)throw new Error('转写记录不存在');
  if(t.transcript_source_id)return {status:'成功',result:{transcriptId:t.id,sourceId:t.transcript_source_id,duplicate:true}};
  const r=runtime(),temp=path.join(dir,'staging','asr-'+t.id),source=store.row('sources',t.source_id);await fsp.mkdir(temp,{recursive:true,mode:0o700});
  store.db.prepare("UPDATE transcripts SET status='转写中',error='',updated_at=? WHERE id=?").run(now(),t.id);
  try{
    stage('检查原文件音轨');const {stdout}=await exec(r.probe,['-v','error','-show_format','-show_streams','-of','json',blobPath(dir,t.blob_hash)],{signal,timeout:20000,maxBuffer:1024*1024});const info=JSON.parse(stdout),duration=Number(info.format?.duration)||0;
    if(!info.streams?.some(s=>s.codec_type==='audio'))throw new Error('原视频没有音轨，无法生成逐字稿');if(duration>7200)throw new Error('单次转写最多2小时，请拆分原文件');
    const wav=path.join(temp,'audio.wav'),out=path.join(temp,'result.json');stage('提取真实音轨（本机）');await exec(r.ffmpeg,['-nostdin','-v','error','-y','-i',blobPath(dir,t.blob_hash),'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',wav],{signal,timeout:300000,maxBuffer:1024*1024});
    stage('SenseVoice 正在逐字识别，保留口语，不改写');await exec(r.python,[path.join(root,'scripts/asr-local.py'),wav,out],{signal,timeout:1800000,maxBuffer:4*1024*1024,env:{...process.env,PYTORCH_ENABLE_MPS_FALLBACK:'1',WORKBENCH_ASR_CACHE:r.cache}});
    const data=JSON.parse(await fsp.readFile(out,'utf8')),body=text(data.text,500000,true);if(!body)throw new Error('未识别到可读语音；没有生成内容');
    if(signal?.aborted)throw new Error('转写已取消');stage('保存原始逐字稿与原视频关系');const raw=await saveBuffer(store,dir,Buffer.from(body),source.title+'-逐字稿.txt');
    return store.transaction(()=>{const derived=store.createSource({title:source.title+' · 逐字稿',url:source.url,kind:'文档',state:'待核对',rights:source.rights,tags:['机器逐字稿','待校对'],notes:'本机语音识别原始结果，未人工核对；未识别画面、无可靠时间戳，不虚构字幕时间。'},'transcript:'+t.blob_hash+':'+source.id+':'+t.version_id);
      if(!derived.duplicate)store.addVersion(derived.source.id,{body,blobHash:raw.hash,filename:raw.name,method:'本机 SenseVoiceSmall 机器转写（未人工核对）',metadata:{originalSourceId:source.id,originalVersionId:t.version_id,originalHash:t.blob_hash,engine:data.engine,hasTimestamps:false,reviewed:false,duration}});
      for(const link of store.db.prepare('SELECT topic_id FROM topic_sources WHERE source_id=?').all(source.id))store.link(link.topic_id,derived.source.id);
      store.db.prepare("UPDATE transcripts SET status='已生成',transcript_source_id=?,error='',updated_at=? WHERE id=?").run(derived.source.id,now(),t.id);
      return {status:'成功',result:{transcriptId:t.id,sourceId:derived.source.id,originalSourceId:source.id,characters:body.length,engine:data.engine,reviewed:false}};});
  }catch(e){const error=signal?.aborted?'转写已取消':String(e.message).startsWith('Command failed')?'本机识别失败，请检查音轨格式或重试（原文件已保留）':e.message;store.db.prepare("UPDATE transcripts SET status='失败',error=?,updated_at=? WHERE id=?").run(error.slice(0,1000),now(),t.id);throw new Error(error);}
  finally{await fsp.rm(temp,{recursive:true,force:true});}
}
export function mediaCandidate(html){
  const dom=new JSDOM(html);let candidate=dom.window.document.querySelector('meta[property="og:video:secure_url"],meta[property="og:video:url"],meta[property="og:video"],meta[property="og:audio"]')?.getAttribute('content')||dom.window.document.querySelector('video source,video,audio source,audio')?.getAttribute('src');
  if(!candidate){for(const tag of dom.window.document.querySelectorAll('script[type="application/ld+json"]'))try{const json=JSON.parse(tag.textContent);const scan=o=>{if(!o||candidate)return;if(Array.isArray(o))return o.forEach(scan);if(typeof o!=='object')return;if(['VideoObject','AudioObject'].includes(o['@type'])&&typeof o.contentUrl==='string')candidate=o.contentUrl;for(const v of Object.values(o))if(typeof v==='object')scan(v);};scan(json);}catch{}}
  dom.window.close();return candidate||'';
}
export async function importVideoLink(store,dir,input,signal,stage=()=>{}){
  const s=store.row('sources',input.sourceId);stage('读取公开视频链接');const response=await fetchPublic(s.url,{signal,maxBytes:128*1024*1024});let media=response,name='导入视频.mp4';
  if(!/^(video|audio)\//.test(response.mime)){
    const page=await saveBuffer(store,dir,response.buffer,'视频链接原始响应.html');store.addVersion(s.id,{blobHash:page.hash,filename:page.name,method:'公开链接响应原件',status:'部分完成',metadata:{finalUrl:response.url}});
    const found=mediaCandidate(response.buffer.toString('utf8'));if(!found)throw new Error('平台未提供公开可下载的音视频；出处已保存。可正常登录后下载原视频再上传，未生成逐字稿。');
    stage('保存页面公开提供的音视频原件');media=await fetchPublic(new URL(found,response.url).href,{signal,maxBytes:128*1024*1024});
    if(!/^(video|audio)\//.test(media.mime))throw new Error('公开地址没有返回音视频原件，不能转写');
  }
  const ext=media.mime.includes('webm')?'.webm':media.mime.includes('mpeg')?'.mp3':media.mime.includes('wav')?'.wav':media.mime.startsWith('audio/')?'.m4a':'.mp4';name='链接原视频'+ext;
  const blob=await saveBlob(store,dir,Readable.from([media.buffer]),name,128*1024*1024);store.addVersion(s.id,{blobHash:blob.hash,filename:name,method:'用户提交链接，实际取得公开音视频原件',status:'成功',metadata:{finalUrl:media.url,originalLink:s.url}});
  const transcript=queueTranscription(store,s.id);return {status:'成功',result:{sourceId:s.id,originalSaved:true,hash:blob.hash,transcriptJobId:transcript.jobId}};
}
export function registerTranscription(app,store,cfg){
  app.get('/api/transcription/status',async()=>transcriptionStatus());
  app.get('/api/transcripts',async req=>transcriptList(store,req.query));
  app.post('/api/sources/:id/transcribe',async req=>queueTranscription(store,req.params.id));
  app.get('/api/transcripts/:id',async req=>{const t=transcriptList(store).find(t=>t.id===req.params.id);if(!t)throw new Error('逐字稿记录不存在');const s=t.transcript_source_id?store.sourceDetail(t.transcript_source_id):null;return {...t,text:s?.versions[0]?.text||'',hash:s?.versions[0]?.blob_hash,filename:s?.versions[0]?.filename};});
  app.post('/api/media/link',async req=>{const url=sourceUrl((text(req.body.url,10000,true).match(/https?:\/\/[^\s<>「」]+/)||[])[0]||''),r=store.createSource({url,title:text(req.body.title,300)||'链接视频 · 待读取',kind:'视频',state:'待整理',rights:'待核实'},'video-link:'+hash(url));if(!r.duplicate)store.addVersion(r.source.id,{method:'视频出处已保存',status:'等待用户补充'});if(req.body.topicId)store.link(req.body.topicId,r.source.id);const pending=store.db.prepare("SELECT id FROM jobs WHERE kind='video-link' AND source_id=? AND status IN ('排队','处理中','等待重试')").get(r.source.id);const job=pending||store.job('video-link',{sourceId:r.source.id},r.source.id);return {sourceId:r.source.id,jobId:job.id,duplicate:r.duplicate};});
}
