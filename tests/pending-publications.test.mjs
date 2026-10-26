import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store,SCHEMA,seedMetrics} from '../server/store.mjs';
import {Analytics} from '../server/analytics.mjs';
import {previewDouyin,parseDouyinExport,commitDouyin} from '../server/douyin.mjs';
import {douyinFixture} from './fixtures/douyin-xlsx.mjs';
import {createBackup,inspectBackup,restoreInspected} from '../server/backup.mjs';

test('历史作品明确待确认后可导入真实指标，不生成虚假脚本版本',()=>{
  const s=new Store(':memory:');
  try{
    const a=s.account({name:'隔离账号',role:'自有'}),t=s.topic({title:'合成测试作品A',account_id:a.id}),body={url:'https://www.douyin.com/video/7000000000000000001',publishedAt:'2026-10-20T12:00:00+08:00'};
    assert.throws(()=>s.publish(t.id,body),/待确认/);
    assert.throws(()=>s.publish(t.id,{...body,versionPending:true}),/依据/);
    const pub=s.publish(t.id,{...body,versionPending:true,versionNote:'仅找到候选稿，尚未核对已发布成片。'});
    assert.equal(pub.version_id,null);
    assert.equal(s.publish(t.id,{...body,versionPending:true,versionNote:'重复登记'}).id,pub.id);
    const other=s.topic({title:'其他选题'});
    assert.throws(()=>s.publish(other.id,{...body,versionPending:true,versionNote:'待核对'}),/已登记/);
    const ana=new Analytics(s),bytes=douyinFixture(),pv=previewDouyin(bytes,ana);
    assert.equal(ana.accountOf(pub.id),a.id);
    const result=commitDouyin(parseDouyinExport(bytes),ana,{accountId:a.id,capturedAt:'2026-10-21T12:00:00+08:00',confirmed:true,selections:[{line:2,publicationId:pub.id}],columns:{...pv.columns,'平均播放时长':{metric:'avg_watch_sec',scale:'分:秒'}}},{hash:null,name:'隔离测试.xlsx'});
    assert.equal(result.ok,1);assert.deepEqual(result.errors,[]);
    const detail=ana.publication(pub.id);
    assert.equal(detail.version.pending,true);assert.equal(detail.version.budget,null);
    assert.equal(detail.snapshots[0].work_id,'7000000000000000001');
    assert.equal(detail.snapshots[0].values.find(v=>v.metric_key==='views').value,0);
    assert.equal(s.db.prepare('SELECT count(*) n FROM script_versions').get().n,0);
    assert.throws(()=>s.topic({title:t.title,account_id:null},t.id),/原账号归属/);
  }finally{s.close();}
});

test('v6迁移保留原发布版本及下游关联，迁移后完整备份可恢复',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pending-migration-')),dir=path.join(root,'data');
  let s;
  try{
    for(const sub of ['','blobs','staging','backups'])await fs.mkdir(path.join(dir,sub),{recursive:true});
    const file=path.join(dir,'workbench.sqlite'),old=new DatabaseSync(file);
    const current=/CREATE TABLE IF NOT EXISTS "publications"\([^\n]+\);/;
    assert.ok(current.test(SCHEMA));
    old.exec(SCHEMA.replace(current,'CREATE TABLE publications(id TEXT PRIMARY KEY,topic_id TEXT NOT NULL REFERENCES topics(id),version_id TEXT NOT NULL REFERENCES script_versions(id),url TEXT NOT NULL,published_at TEXT NOT NULL,timezone TEXT NOT NULL,created_at TEXT NOT NULL);'));
    seedMetrics(old);
    old.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run('a','旧账号','自有','','2026-10-01');
    old.prepare('INSERT INTO topics VALUES(?,?,?,?,?,?,?)').run('t','旧作品','a','发布','','2026-10-01','2026-10-01');
    old.prepare('INSERT INTO scripts VALUES(?,?,?,?,?)').run('s','t','{}',1,'2026-10-01');
    old.prepare('INSERT INTO script_versions VALUES(?,?,?,?,?,?)').run('v','s',1,'已采用旧稿',JSON.stringify({topic:{id:'t',account_id:'a'},draft:{segments:[]}}),'2026-10-01');
    old.prepare('INSERT INTO publications VALUES(?,?,?,?,?,?,?)').run('p','t','v','https://example.org/old','2026-10-01T00:00:00Z','Asia/Shanghai','2026-10-01');
    old.prepare("INSERT INTO metric_snapshots(id,publication_id,platform,captured_at,window_label,origin,created_at) VALUES('m','p','抖音','2026-10-02T00:00:00Z','24小时','隔离测试','2026-10-02')").run();
    old.prepare('INSERT INTO settings VALUES(?,?)').run('schemaVersion','6');old.close();
    s=new Store(file);
    assert.equal(s.get('schemaVersion'),7);assert.equal(s.row('publications','p').version_id,'v');
    assert.equal(new Analytics(s).publication('p').version.pending,false);
    assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(s.db.prepare('SELECT publication_id FROM metric_snapshots WHERE id=?').get('m').publication_id,'p');
    const draft=s.topic({title:'待核对作品',account_id:'a'});
    s.publish(draft.id,{url:'https://example.org/new-pending',publishedAt:'2026-10-03T00:00:00Z',versionPending:true,versionNote:'隔离验证待确认状态'});
    const b=await createBackup(s,dir),preview=await inspectBackup(path.join(dir,'backups',b.filename),root);
    assert.equal(preview.verified,true);
    const restored=await restoreInspected(preview,path.join(root,'restored'),{confirm:true}),r=new Store(path.join(restored.dataDirectory,'workbench.sqlite'));
    try{assert.equal(r.db.prepare('SELECT count(*) n FROM publications').get().n,2);assert.equal(r.row('publications','p').version_id,'v');assert.equal(r.db.prepare('SELECT count(*) n FROM publications WHERE version_id IS NULL').get().n,1);}finally{r.close();}
  }finally{s?.close();await fs.rm(root,{recursive:true,force:true});}
});
