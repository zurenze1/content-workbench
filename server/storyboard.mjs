// Storyboard data lives in the existing versioned script, alongside the original text.
export function validateStoryboard(store,topicId,segment){
  const result={};
  for(const key of ['startSec','endSec'])if(segment[key]!==undefined){
    const n=segment[key];if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0||n>86400))throw new Error('分镜时间应为0—86400秒，未知请留空');
    result[key]=n===null?null:Math.round(n*1000)/1000;
  }
  if(result.startSec!=null&&result.endSec!=null&&result.endSec<=result.startSec)throw new Error('分镜结束时间必须晚于开始时间');
  if(segment.materials!==undefined){
    if(!Array.isArray(segment.materials)||segment.materials.length>20)throw new Error('每行最多20份素材');
    const seen=new Set();result.materials=segment.materials.map(m=>{
      if(!m||typeof m.sourceId!=='string'||typeof m.versionId!=='string')throw new Error('分镜素材引用无效');
      const v=store.row('source_versions',m.versionId);
      if(v.source_id!==m.sourceId)throw new Error('素材版本不属于此资料');
      if(!store.db.prepare('SELECT 1 FROM topic_sources WHERE topic_id=? AND source_id=?').get(topicId,m.sourceId))throw new Error('分镜素材需要先关联此选题');
      if(seen.has(m.versionId))throw new Error('同一行的素材版本重复');seen.add(m.versionId);
      return {sourceId:m.sourceId,versionId:m.versionId};
    });
  }
  return result;
}
export function snapshotMaterials(store,draft){
  const materials={};
  for(const s of draft.segments)for(const ref of s.materials||[]){
    if(materials[ref.versionId])continue;
    const v=store.row('source_versions',ref.versionId),source=store.row('sources',ref.sourceId);
    materials[v.id]={sourceId:source.id,versionId:v.id,number:v.number,blob_hash:v.blob_hash,filename:v.filename,created_at:v.created_at,status:v.status,method:v.method,metadata:JSON.parse(v.metadata),source:{title:source.title,url:source.url,kind:source.kind,rights:source.rights,verification:source.verification}};
  }
  return materials;
}
export function timeLabel(n){if(n==null)return '待定';const ms=Math.round(n*1000),seconds=(ms%60000)/1000;return `${Math.floor(ms/60000).toString().padStart(2,'0')}:${seconds<10?'0':''}${seconds.toFixed(3).replace(/\.?0+$/,'')}`;}
