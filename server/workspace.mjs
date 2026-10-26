import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {hash,uid,now,text} from './store.mjs';
import {saveBlob,blobPath} from './files.mjs';
import {extractFile} from './extract.mjs';
import {collectionContext,assetBucket,videoInventory} from './curation.mjs';

export const ARCHIVE_ROOT=path.join(os.homedir(),'Desktop/02_内容创作/自媒体个人工作台');
const supported=new Set('.md .txt .csv .json .srt .vtt .pdf .docx .xlsx .html .htm .jpg .jpeg .png .webp .gif .svg .mp4 .mov .webm .m4v .wav .mp3 .m4a .flac .ogg .pptx .zip'.split(' '));
const textTypes=new Set('.md .txt .csv .srt .vtt .pdf .docx .xlsx .html .htm'.split(' '));
const secret=/(?:sk-proj-|sk-ant-|ghp_|github_pat_|Bearer )[A-Za-z0-9_-]{20,}/;
export function assetCategory(p){return /(^|\/)(tmp|qa|source|work|assets|frames|frames_.*|截图|抽帧|工具|校验|归档|旧版)(\/|$)|过程|试听|候选|预览校验|截图|接触表|关键帧/i.test(p)?'制作过程':/参考|素材|原片|来源|reference/i.test(p)?'参考素材':/研究|调研|蒸馏|对标|核验|事实|资料|来源清单/.test(p)?'研究资料':/脚本|逐字稿|文案|旁白|口播|稿件/.test(p)?'脚本与文稿':/最终|导出|成片|交付|发布|renders|outputs/i.test(p)?'作品与交付':'项目文件';}
export async function scanArchive(root=ARCHIVE_ROOT){const actual=await fsp.realpath(root),items=[],excluded={};let visited=0;async function walk(dir){for(const e of await fsp.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isSymbolicLink()){excluded.symlink=(excluded.symlink||0)+1;continue;}if(e.isDirectory()){if(e.name.startsWith('.')||['node_modules','venv','__pycache__'].includes(e.name))continue;await walk(file);}else if(e.isFile()){visited++;const ext=path.extname(e.name).toLowerCase();if(!supported.has(ext)||/^(AGENTS|CLAUDE|SKILL)\.md$|^\.env/.test(e.name)){excluded.engineering=(excluded.engineering||0)+1;continue;}const stat=await fsp.stat(file),relative=path.relative(actual,file);if(!stat.size||stat.size>1024**3){excluded.size=(excluded.size||0)+1;continue;}items.push({path:file,relative,project:relative.split(path.sep).length>1?relative.split(path.sep)[0]:'其他项目',name:e.name,category:assetCategory(relative),bytes:stat.size,modifiedAt:stat.mtime.toISOString()});}}}await walk(actual);return {items,visited,excluded,root:actual};}
export async function archiveFiles(store,dir,root=ARCHIVE_ROOT,signal,progress=()=>{}){
  const scan=await scanArchive(root),stats={visited:scan.visited,candidates:scan.items.length,saved:0,unchanged:0,failed:0,bytes:0,excluded:scan.excluded,errors:[],at:now()};
  store.set('workspace.archiveProgress',{...stats,status:'进行中'});
  for(const [i,item] of scan.items.entries()){
    if(signal?.aborted){store.set('workspace.archiveProgress',{...stats,status:'已取消'});throw new Error('归集已取消；已保存原文件保留，再次运行可继续');}
    try{
      // Resolve again immediately before reading, so a replaced symlink cannot escape the authorized root.
      const actual=await fsp.realpath(item.path);if(!actual.startsWith(scan.root+path.sep))throw new Error('原路径已变化，超出创作目录');
      const originalPath=path.join(path.resolve(root),item.relative);
      const stat=await fsp.stat(actual),prior=store.db.prepare('SELECT id FROM archive_assets WHERE path IN (?,?) AND bytes=? AND modified_at=?').get(originalPath,actual,stat.size,stat.mtime.toISOString());
      if(prior){stats.unchanged++;continue;}
      const ext=path.extname(item.name).toLowerCase();
      if(['.md','.txt','.csv','.json','.html','.htm'].includes(ext)&&stat.size<=12*1024**2&&secret.test(await fsp.readFile(actual,'utf8')))throw new Error('含疑似凭据，未收录');
      let blob,formatNote='';
      try{blob=await saveBlob(store,dir,fs.createReadStream(actual,{signal}),item.name);}
      catch(e){if(!/文件头不匹配/.test(e.message))throw e;const h=await fsp.open(actual,'r'),prefix=Buffer.alloc(16);try{await h.read(prefix,0,16,0);}finally{await h.close();}const corrected=prefix[0]===255&&prefix[1]===216?'.jpg':prefix.subarray(0,4).toString()==='RIFF'&&prefix.subarray(8,12).toString()==='WEBP'?'.webp':'.original';blob=await saveBlob(store,dir,fs.createReadStream(actual,{signal}),item.name+corrected);formatNote='原扩展名与文件头不符，原始字节完整保留；';}
      const after=await fsp.stat(actual);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new Error('读取期间原文件被修改，保留已保存字节，下一次重新归集');
      let body='',scope=formatNote+'原文件完整保存；未分析画面或转写声音';
      if(textTypes.has(ext))try{const r=await extractFile(blob.path,item.name,blob.mime);body=r.body;scope=r.method+(r.error?'；'+r.error:'；内容待核验');}catch(e){scope='原文件已保存，文字未解析：'+e.message;}
      const kind=blob.mime.startsWith('video/')?'视频':blob.mime.startsWith('audio/')?'音频':blob.mime.startsWith('image/')?'图片':'文档';
      const inserted=store.db.prepare('INSERT OR IGNORE INTO archive_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(uid(),originalPath,item.project,item.name,kind,item.category,blob.hash,blob.size,item.modifiedAt,body,scope,null,now()).changes;
      if(inserted){stats.saved++;stats.bytes+=blob.size;}else stats.unchanged++;
    }catch(e){if(signal?.aborted){store.set('workspace.archiveProgress',{...stats,status:'已取消'});throw e;}stats.failed++;stats.errors.push({path:item.relative,error:String(e.message).slice(0,200)});}
    if(i%20===0||i===scan.items.length-1){progress(`归集原件 ${i+1}/${scan.items.length} · ${item.project}`);store.set('workspace.archiveProgress',{...stats,status:'进行中'});}
  }
  store.set('workspace.archiveProgress',{...stats,status:stats.failed?'部分完成':'已完成'});return stats;
}
export function archiveList(store,q={}){
  const clauses=[],params=[];
  for(const [key,col] of [['project','project'],['category','category'],['kind','kind']])if(q[key]){clauses.push(col+'=?');params.push(text(q[key],300));}
  if(q.q){const pat='%'+text(q.q,200).replace(/[\\%_]/g,c=>'\\'+c)+'%';clauses.push("(name LIKE ? ESCAPE '\\' OR project LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");params.push(pat,pat,pat);}
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'',offset=Math.max(0,Number.parseInt(q.offset)||0),ctx=collectionContext(store);
  const raw=store.db.prepare('SELECT id,project,name,kind,category,blob_hash,bytes,modified_at,source_id,read_scope FROM archive_assets'+where+' ORDER BY modified_at DESC,id').all(...params).map(a=>({...a,bucket:assetBucket(a,ctx),trashedAt:ctx.states[a.blob_hash]?.trashedAt})).filter(a=>(q.state==='trash'?!!a.trashedAt:!a.trashedAt)&&(!q.bucket||a.bucket===q.bucket));
  const items=[...new Map(raw.map(a=>[a.blob_hash,a]).reverse()).values()].sort((a,b)=>b.modified_at.localeCompare(a.modified_at)||a.id.localeCompare(b.id));
  return {total:items.length,recordCount:raw.length,offset,limit:50,items:items.slice(offset,offset+50),projects:store.db.prepare('SELECT project,count(*) count FROM archive_assets GROUP BY project ORDER BY project DESC').all(),progress:store.get('workspace.archiveProgress')||null};
}
export function promoteAsset(store,id,topicId){const a=store.db.prepare('SELECT * FROM archive_assets WHERE id=?').get(id);if(!a)throw new Error('档案不存在');return store.transaction(()=>{let sourceId=a.source_id;if(!sourceId){const {source,duplicate}=store.createSource({title:a.name,kind:a.kind,rights:'待核实',tags:['本机创作档案',a.project,a.category],notes:'原始创作档案：'+a.path+'；原修改时间：'+a.modified_at},'file:'+a.blob_hash+':');sourceId=source.id;if(!duplicate)store.addVersion(sourceId,{body:a.body,blobHash:a.blob_hash,filename:a.name,method:'本机创作档案转为资料；'+a.read_scope,metadata:{originalPath:a.path,originalModifiedAt:a.modified_at}});store.db.prepare('UPDATE archive_assets SET source_id=? WHERE id=?').run(sourceId,id);}if(topicId)store.link(topicId,sourceId);return {sourceId};});}
export function workspaceSummary(store){const count=t=>store.db.prepare(`SELECT count(*) n FROM ${t}`).get().n,media=videoInventory(store),active=media.filter(v=>!v.curation.trashedAt);return {counts:Object.fromEntries(['sources','topics','scripts','script_versions','publications','publish_plans','variants','metric_snapshots','experiments','archive_assets','hot_events','public_events','transcripts'].map(t=>[t,count(t)])),videos:media.length,collection:{works:new Set(active.filter(v=>v.bucket==='作品').map(v=>v.collection||v.title)).size,workFiles:active.filter(v=>v.bucket==='作品').length,materials:active.filter(v=>v.bucket==='素材').length,process:active.filter(v=>v.bucket==='制作过程').length,trashed:media.filter(v=>v.curation.trashedAt).length},conversations:(store.get('studio.conversations')||[]).length,archive:store.get('workspace.archiveProgress')||null,audit:store.get('workspace.audit')||null};}
export function registerWorkspace(app,store,cfg){
  app.get('/api/workspace/appearance',async()=>({theme:'paper',motion:true,...store.get('workspace.appearance')}));
  app.put('/api/workspace/appearance',async req=>{const old={theme:'paper',motion:true,...store.get('workspace.appearance')},b=req.body||{};if(b.theme!==undefined&&!['blue','paper','rose','night'].includes(b.theme))throw new Error('请选择浅蓝或深空蓝主题');if(b.motion!==undefined&&typeof b.motion!=='boolean')throw new Error('动态开关无效');const next={theme:b.theme??old.theme,motion:b.motion??old.motion};store.set('workspace.appearance',next);return next;});
  app.get('/api/workspace',async()=>{const summary=workspaceSummary(store),story=new Set(),other=new Set();for(const v of videoInventory(store))for(const t of store.db.prepare('SELECT topic_id FROM topic_sources WHERE source_id=?').all(v.id))(v.category==='人物故事'?story:other).add(t.topic_id);return {...summary,nonStoryTopicIds:[...other].filter(id=>!story.has(id))};});
  app.get('/api/workspace/archive',async req=>archiveList(store,req.query));
  app.get('/api/workspace/archive/:id',async req=>{const a=store.db.prepare('SELECT * FROM archive_assets WHERE id=?').get(req.params.id);if(!a)throw new Error('档案不存在');return a;});
  app.post('/api/workspace/archive/:id/material',async req=>promoteAsset(store,req.params.id,req.body?.topicId));
  app.post('/api/workspace/archive',async()=>{if(store.db.prepare("SELECT id FROM jobs WHERE kind='workspace-archive' AND status IN ('排队','处理中','等待重试')").get())throw new Error('已有归集任务在运行');return store.jobView(store.job('workspace-archive',{}));});
}
