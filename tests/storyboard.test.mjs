import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store,parse,uid} from '../server/store.mjs';
import {saveBuffer,blobPath,fileHash} from '../server/files.mjs';
import {exportVersion} from '../server/export.mjs';
import {createBackup,inspectBackup,restoreInspected} from '../server/backup.mjs';
import {Operations} from '../server/operations.mjs';
import {parseTime,formatTime,sentenceParts,splitForStoryboard} from '../src/storyboard-model.ts';
import {unzipSync,strFromU8} from 'fflate';

test('分镜时间：分秒、小数、中文、零与未知；拒绝无效和反向区间',()=>{
  assert.equal(parseTime('01:23.5'),83.5);assert.equal(parseTime('1分23秒'),83);assert.equal(parseTime('83.125'),83.125);assert.equal(parseTime('0'),0);assert.equal(parseTime(''),null);assert.equal(formatTime(0),'00:00');assert.equal(formatTime(60),'01:00');assert.equal(formatTime(83.5),'01:23.5');assert.equal(formatTime(null),'');
  for(const s of ['-1','00:60','1:3:5','Infinity','86401','0.1234'])assert.throws(()=>parseTime(s));
  const store=new Store(':memory:');try{const topic=store.topic({title:'隔离分镜时间'}),draft={title:'脚本',segments:[{id:'one',evidenceIds:[],startSec:0,endSec:0}]};assert.throws(()=>store.saveDraft(topic.id,{draft}),/结束时间/);draft.segments[0].endSec=1;assert.equal(store.saveDraft(topic.id,{draft}).draft.segments[0].startSec,0);for(const value of [-1,'2',Infinity,NaN,86401])assert.throws(()=>store.validateDraft({...draft,segments:[{...draft.segments[0],startSec:value}]},topic.id),/分镜时间/);}finally{store.close();}
});

test('逐句拆分保留原字、闭引号、换行、证据及预算；不臆测时间或错配素材',()=>{
  const raw='他说：“你好！”\n第二句。  第三句？\n尾句没有标点';assert.equal(sentenceParts(raw).join(''),raw);assert.equal(sentenceParts('甲。\n乙。').length,2);
  const draft={segments:[{id:'old',heading:'开头',narration:raw,shot:'寻找原片',subtitle:'',evidenceIds:['e']}],budget:{sections:[{segmentIds:['old']}]}};
  const split=splitForStoryboard(draft,uid);assert.equal(split.segments.map(s=>s.narration).join(''),raw);assert.equal(draft.segments.length,1);assert.equal(split.segments[0].id,'old');assert.equal(new Set(split.segments.map(s=>s.id)).size,4);assert.equal(split.budget.sections[0].segmentIds.length,4);assert.ok(split.segments.every(s=>s.startSec==null&&s.evidenceIds[0]==='e'));
  assert.throws(()=>splitForStoryboard({...draft,segments:[{...draft.segments[0],startSec:0}]},uid),/手动拆分/);
  assert.throws(()=>splitForStoryboard({...draft,segments:[{...draft.segments[0],materials:[{sourceId:'s',versionId:'v'}]}]},uid),/手动拆分/);
});

test('分镜引用必须关联选题且属于指定来源；快照和导出固定旧素材版本',()=>{
  const s=new Store(':memory:');try{
    const t=s.topic({title:'隔离分镜'}),source=s.createSource({title:'旧素材标题',url:'https://example.org/storyboard-original',rights:'仅作参考'}).source,v=s.addVersion(source.id,{body:'测试原文',filename:'原文.txt'}),other=s.createSource({title:'另一来源'}).source;
    const row={id:'one',narration:'第一句。',evidenceIds:[],startSec:0,endSec:3.5,materials:[{sourceId:source.id,versionId:v.id}]},draft={title:'逐句脚本',segments:[row]};
    assert.throws(()=>s.saveDraft(t.id,{draft}),/先关联/);s.link(t.id,source.id);
    assert.throws(()=>s.saveDraft(t.id,{draft:{...draft,segments:[{...row,materials:[{sourceId:other.id,versionId:v.id}]}]}}),/不属于/);
    assert.throws(()=>s.saveDraft(t.id,{draft:{...draft,segments:[{...row,materials:[...row.materials,...row.materials]}]}}),/重复/);
    const saved=s.saveDraft(t.id,{draft}),version=s.snapshot(t.id,'旧素材快照');s.updateSource(source.id,{title:'已修改标题',rights:'不可使用'});
    const exported=exportVersion(s,version.id);assert.equal(exported.json.materials[v.id].metadata.title,'旧素材标题');assert.ok(exported.markdown.includes('00:00 → 00:03.5'));assert.ok(exported.markdown.includes('storyboard-original'));assert.ok(exported.markdown.includes('仅作参考'));assert.ok(!exported.markdown.includes('已修改标题'));
    s.saveDraft(t.id,{draft:{...draft,segments:[{...row,materials:[]}]},revision:saved.revision});assert.equal(parse(s.row('script_versions',version.id).payload).draft.segments[0].materials[0].versionId,v.id);
    assert.throws(()=>s.saveDraft(t.id,{draft,revision:saved.revision}),/其他窗口/);
  }finally{s.close();}
});

test('分镜原件：数据库重开、交付ZIP、完整备份及恢复均保留真实字节与关系',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'storyboard-')),dir=path.join(root,'data');for(const n of ['blobs','staging','backups','restored'])await fs.mkdir(path.join(dir,n),{recursive:true});let s=new Store(path.join(dir,'workbench.sqlite'));
  try{
    const a=s.account({name:'分镜隔离IP',role:'自有'}),t=s.topic({title:'分镜隔离选题',account_id:a.id}),bytes=await fs.readFile(new URL('./fixtures/video.mp4',import.meta.url)),blob=await saveBuffer(s,dir,bytes,'测试原视频.mp4'),source=s.createSource({title:'分镜测试原视频',kind:'视频',rights:'待核实',url:'https://example.org/video-original'}).source,v=s.addVersion(source.id,{blobHash:blob.hash,filename:'测试原视频.mp4',status:'成功',method:'仅存原片，未分析视频'});s.link(t.id,source.id);
    s.saveDraft(t.id,{draft:{title:'分镜验收',segments:[{id:'one',narration:'合成测试第一句。',shot:'用于原件保存测试',evidenceIds:[],startSec:0,endSec:2,editNote:'恢复后保留主选与剪辑说明',materials:[{sourceId:source.id,versionId:v.id,role:'主选'}]}]}});const version=s.snapshot(t.id,'分镜验收快照');s.close();s=new Store(path.join(dir,'workbench.sqlite'));
    assert.equal(s.draft(t.id).draft.segments[0].materials[0].versionId,v.id);assert.equal((await fileHash(blobPath(dir,blob.hash))).hash,blob.hash);
    const ops=new Operations(s,dir),h=await ops.handoff(t.id,{versionId:version.id}),zip=unzipSync(new Uint8Array(await fs.readFile(blobPath(dir,h.blob_hash)))),manifest=JSON.parse(strFromU8(zip['交付清单.json']));assert.equal(manifest.originals.length,1);assert.deepEqual(Buffer.from(zip[manifest.originals[0].path]),bytes);
    const backup=await createBackup(s,dir),preview=await inspectBackup(path.join(dir,'backups',backup.filename),root),restored=await restoreInspected(preview,path.join(root,'restored-data'),{confirm:true}),r=new Store(path.join(restored.dataDirectory,'workbench.sqlite'));try{assert.equal(r.draft(t.id).draft.segments[0].startSec,0);assert.equal(r.draft(t.id).draft.segments[0].editNote,'恢复后保留主选与剪辑说明');assert.equal(r.draft(t.id).draft.segments[0].materials[0].role,'主选');assert.equal(r.draft(t.id).draft.segments[0].materials[0].versionId,v.id);assert.deepEqual(await fs.readFile(blobPath(restored.dataDirectory,blob.hash)),bytes);assert.equal(r.db.prepare('PRAGMA foreign_key_check').all().length,0);}finally{r.close();}
  }finally{s.close();await fs.rm(root,{recursive:true,force:true});}
});
