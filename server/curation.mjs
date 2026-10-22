import {hash,now,uid} from './store.mjs';

export const BUCKETS=['作品','素材','制作过程'];
export function videoBucket(v){
  const name=v.filename||v.title||'';
  if(['参考片段','处理片段','品牌动效'].includes(v.category)||/^M\d{3}[-_]/i.test(name))return '素材';
  if(/预览|样片|样板|试听|声音测试|摘录|连续校看|科研段|^开头_|^收尾_|^手摇计算机_/.test(name))return '制作过程';
  return '作品';
}
export function revisionOf(v){
  const name=v.filename||v.title||'',n=[...name.matchAll(/(?:^|[_\-])v(\d+(?:\.\d+)?)(?=[_\-.]|$)/ig)].filter(m=>!(m.index===0&&/^\d{3,}$/.test(m[1]))).at(-1);
  if(n)return 'v'+n[1];
  const cn=(v.title||'').match(/第([一二三四五六七八九十])版/);if(cn)return '第'+cn[1]+'版';
  return (v.title||name).replace(/(?:1080|720|2160|3840)[pP]?|\d+x\d+/g,'').replace(/[_\- ]+/g,' ').trim();
}
export function videoInventory(store){
  const state=store.get('collection.curation')||{};
  return Object.entries(store.get('studio.videos')||{}).flatMap(([id,v])=>{const s=store.db.prepare('SELECT title FROM sources WHERE id=?').get(id),file=store.db.prepare('SELECT blob_hash,filename FROM source_versions WHERE source_id=? ORDER BY number DESC LIMIT 1').get(id);if(!s||!file?.blob_hash)return [];const row={...v,id,title:s.title,filename:file.filename,hash:file.blob_hash};return [{...row,bucket:state[row.hash]?.bucket||videoBucket(row),revision:revisionOf(row),curation:state[row.hash]||{}}];});
}
export function collectionContext(store){const states=store.get('collection.curation')||{},media=new Map(videoInventory(store).map(v=>[v.hash,v]));return {states,media};}
export function assetBucket(a,ctx){return ctx.states[a.blob_hash]?.bucket||ctx.media.get(a.blob_hash)?.bucket||(a.category==='制作过程'?'制作过程':'素材');}
export function cleanupPlan(store){
  const all=videoInventory(store),active=all.filter(v=>!v.curation.trashedAt),groups=new Map(),remove=[];
  for(const v of active){if(/废弃|已弃用|作废/.test(v.title+' '+v.filename)){remove.push({...v,reason:'文件名明确标记为弃用'});continue;}if(v.bucket!=='作品')continue;const family=v.collection||v.title;if(!groups.has(family))groups.set(family,[]);groups.get(family).push(v);}
  const families=[];
  for(const [name,items] of groups){items.sort((a,b)=>(b.modifiedAt||b.importedAt||'').localeCompare(a.modifiedAt||a.importedAt||'')||a.id.localeCompare(b.id));const revisions=[...new Set(items.map(v=>v.revision))],keep=new Set(revisions.slice(0,2));const old=items.filter(v=>!keep.has(v.revision));remove.push(...old.map(v=>({...v,reason:'同一作品仅保留最近两版；按原文件修改时间排序'})));families.push({name,keptRevisions:revisions.slice(0,2),kept:items.filter(v=>keep.has(v.revision)).map(v=>v.id),removed:old.map(v=>v.id)});}
  const items=[...new Map(remove.map(v=>[v.hash,v])).values()].map(v=>({id:v.id,hash:v.hash,title:v.title,collection:v.collection,revision:v.revision,reason:v.reason}));
  return {keep:2,items,families,fingerprint:hash(JSON.stringify({items,families})),note:'每个作品保留最近两版，同版不同清晰度合并展示。旧版移入回收站，可恢复；素材不套用作品删版规则。'};
}
export function trimCollection(store,fingerprint){return store.transaction(()=>{const plan=cleanupPlan(store);if(plan.fingerprint!==fingerprint)throw new Error('版本清单已变化，请重新预览');if(!plan.items.length)return {...plan,moved:0};const states=store.get('collection.curation')||{},batch=uid(),at=now();for(const item of plan.items)states[item.hash]={...states[item.hash],trashedAt:at,reason:item.reason,batch};store.set('collection.curation',states);const result={...plan,batch,at,moved:plan.items.length};store.set('collection.lastCleanup',result);return result;});}
function knownHash(store,h){return /^[0-9a-f]{64}$/.test(h)&&(store.db.prepare('SELECT id FROM archive_assets WHERE blob_hash=? LIMIT 1').get(h)||store.db.prepare('SELECT id FROM source_versions WHERE blob_hash=? LIMIT 1').get(h));}
export function curateItem(store,h,b){if(!knownHash(store,h))throw new Error('文件不存在');if(b.bucket!==undefined&&!BUCKETS.includes(b.bucket))throw new Error('请选择素材、作品或制作过程');if(b.trashed!==undefined&&typeof b.trashed!=='boolean')throw new Error('回收状态无效');return store.transaction(()=>{const states=store.get('collection.curation')||{},s={...states[h]};if(b.bucket)s.bucket=b.bucket;if(b.trashed===true){s.trashedAt=now();s.reason='祖老大手动移入回收站';delete s.batch;}if(b.trashed===false){delete s.trashedAt;delete s.reason;delete s.batch;}states[h]=s;store.set('collection.curation',states);return s;});}
export function trashList(store){const ctx=collectionContext(store);return Object.entries(ctx.states).filter(([,s])=>s.trashedAt).map(([h,s])=>{const a=store.db.prepare('SELECT id,name,project FROM archive_assets WHERE blob_hash=? ORDER BY modified_at DESC LIMIT 1').get(h),v=ctx.media.get(h);return {hash:h,...s,title:v?.title||a?.name||'原文件',collection:v?.collection||a?.project||'',bucket:s.bucket||v?.bucket||'素材'};}).sort((a,b)=>b.trashedAt.localeCompare(a.trashedAt));}
export function registerCuration(app,store){
  app.get('/api/collection/plan',async()=>cleanupPlan(store));
  app.post('/api/collection/trim',async req=>trimCollection(store,req.body?.fingerprint));
  app.get('/api/collection/trash',async()=>({items:trashList(store),lastCleanup:store.get('collection.lastCleanup')}));
  app.patch('/api/collection/items/:hash',async req=>curateItem(store,req.params.hash,req.body||{}));
  app.post('/api/collection/undo',async req=>store.transaction(()=>{const last=store.get('collection.lastCleanup');if(!last||req.body?.batch!==last.batch)throw new Error('请刷新回收站后重试');const states=store.get('collection.curation')||{};let restored=0;for(const s of Object.values(states))if(s.batch===last.batch){delete s.trashedAt;delete s.reason;delete s.batch;restored++;}store.set('collection.curation',states);return {restored};}));
}
