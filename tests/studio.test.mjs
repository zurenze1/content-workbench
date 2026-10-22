import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {importVideos,videos,allowedMedia,conversations} from '../server/studio.mjs';
import {createBackup,inspectBackup} from '../server/backup.mjs';

test('视频迁移：真实复制、重复合并、来源保留、笔记和对话随完整备份恢复',async()=>{
  await fs.mkdir(path.join(os.homedir(),'Documents/Codex'),{recursive:true});
  const parent=await fs.mkdtemp(path.join(os.homedir(),'Documents/Codex/workbench-import-test-')),dir=path.join(parent,'data');
  for(const n of ['blobs','staging','backups','restored'])await fs.mkdir(path.join(dir,n),{recursive:true});
  const file=path.join(parent,'isolated-video.mp4'),same=path.join(parent,'same-video.mp4');await fs.copyFile(new URL('./fixtures/video.mp4',import.meta.url),file);await fs.copyFile(file,same);
  const store=new Store(path.join(dir,'workbench.sqlite'));
  try{
    const item={path:file,title:'隔离迁移夹具',category:'处理片段',collection:'测试',version:'已导出'};
    const result=await importVideos(store,dir,[item,{...item,path:same}],new AbortController().signal);
    assert.equal(result.imported,1);assert.equal(result.duplicates,1);assert.equal(result.failed,0);
    let list=videos(store);assert.equal(list.length,1);assert.equal(list[0].originalPaths.length,2);assert.equal(list[0].rights,'待核实');
    const bytes=await fs.readFile(file);assert.ok(bytes.equals(await fs.readFile(path.join(dir,'blobs',list[0].hash))));assert.ok(bytes.equals(await fs.readFile(same)));
    assert.equal(store.sourceDetail(list[0].id).versions.length,1,'重复内容不产生新来源版本');
    const marks=store.get('studio.videos');marks[list[0].id].favorite=true;marks[list[0].id].notes='本机创作笔记';store.set('studio.videos',marks);
    store.set('studio.conversations',[{id:'c',messages:[{id:'m',role:'assistant',content:'模型生成建议',status:'成功'}]}]);
    const backup=await createBackup(store,dir);const restored=await inspectBackup(path.join(dir,'backups',backup.filename),path.join(dir,'restored'));
    const read=new Store(path.join(restored.target,'workbench.sqlite'),{readonly:true});try{list=videos(read);assert.equal(list[0].notes,'本机创作笔记');assert.equal(list[0].favorite,true);assert.equal(conversations(read)[0].messages[0].content,'模型生成建议');}finally{read.close();}
    assert.throws(()=>allowedMedia('/etc/hosts'),/已授权/);
    const abort=new AbortController();abort.abort();await assert.rejects(()=>importVideos(store,dir,[item],abort.signal),/已取消/);
  }finally{store.close();await fs.rm(parent,{recursive:true,force:true});}
});

test('助手任务：取消、失败及重试后对话状态与持久任务一致',()=>{
  const store=new Store(':memory:');try{
    const j=store.job('studio-chat',{});store.set('studio.conversations',[{id:'c',messages:[{id:'m',role:'assistant',jobId:j.id,status:'排队',content:''}]}]);
    store.db.prepare("UPDATE jobs SET status='已取消' WHERE id=?").run(j.id);assert.equal(conversations(store)[0].messages[0].status,'已取消');
    store.db.prepare("UPDATE jobs SET status='失败',error='真实连接失败' WHERE id=?").run(j.id);assert.equal(conversations(store)[0].messages[0].error,'真实连接失败');
    store.db.prepare("UPDATE jobs SET status='排队',error='' WHERE id=?").run(j.id);assert.equal(conversations(store)[0].messages[0].status,'排队');
  }finally{store.close();}
});
test('视频扫描：桌面整理后的02_内容创作纳入、工程目录排除、Codex输出不限日期',async()=>{const src=await import('node:fs').then(f=>f.readFileSync('server/studio.mjs','utf8'));assert.match(src,/Desktop\/02_内容创作/);assert.match(src,/e\.name\.startsWith\('_'\)/);assert.doesNotMatch(src,/2026-10-\(0\[5-9\]/);});
