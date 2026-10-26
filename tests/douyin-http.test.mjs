import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {douyinFixture} from './fixtures/douyin-xlsx.mjs';
import {inspectBackup,restoreInspected} from '../server/backup.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));

test('抖音HTTP：CSRF、Excel原件、确认入库、重启、备份与恢复字节一致',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'douyin-http-')),dir=path.join(root,'data');let server,csrf,log='';const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const base='http://127.0.0.1:'+port+'/api';
  async function start(){server=spawn(process.execPath,['server/main.mjs','--data',dir,'--port',String(port)],{stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);for(let i=0;i<100;i++){try{const r=await fetch(base+'/bootstrap');if(r.ok){csrf=(await r.json()).csrf;return;}}catch{}if(server.exitCode!=null)throw new Error(log);await delay(50);}throw new Error('隔离服务未启动');}
  async function stop(){if(server?.exitCode===null&&server.signalCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}}
  async function call(url,body){const r=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'x-workbench-csrf':csrf,...(body!==undefined&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});const value=await r.json();if(!r.ok)throw Object.assign(new Error(value.error),{status:r.status});return value;}
  try{await start();assert.equal((await call('/douyin/status')).automaticCollection,false);const account=await call('/accounts',{name:'合成测试账号',role:'自有'}),topic=await call('/topics',{title:'合成测试作品A',account_id:account.id});await fetch(base+'/topics/'+topic.id+'/script',{method:'PUT',headers:{'x-workbench-csrf':csrf,'content-type':'application/json'},body:JSON.stringify({draft:{title:'合成测试作品A',segments:[{id:'s',heading:'测试',narration:'仅用于隔离验证',evidenceIds:[]}]}})});const version=await call('/topics/'+topic.id+'/versions',{label:'合成测试'}),pub=await call('/topics/'+topic.id+'/publications',{versionId:version.id,url:'https://example.org/synthetic',publishedAt:'2026-10-20T12:00:00+08:00'}),bytes=douyinFixture();
    const shell=await fetch(base.replace(/\/api$/,'/'),{headers:{'sec-fetch-site':'cross-site'}});assert.equal(shell.status,200,'外部入口可打开不含私有数据的应用页面');
    const privateRead=await fetch(base+'/bootstrap',{headers:{'sec-fetch-site':'cross-site'}});assert.equal(privateRead.status,403,'跨站读取后台数据仍被拒绝');
    const bad=await fetch(base+'/douyin/import',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(bad.status,403);
    const form=new FormData();form.append('file',new Blob([bytes]),'合成测试作品列表.xlsx');const preview=await call('/douyin/preview',form);assert.equal(preview.total,2);assert.ok(Buffer.from(await(await fetch(base+'/blobs/'+preview.original.hash)).arrayBuffer()).equals(bytes));
    const columns={...preview.columns,'平均播放时长':{metric:'avg_watch_sec',scale:'分:秒'}},body={blobHash:preview.original.hash,filename:preview.original.filename,accountId:account.id,capturedAt:'2026-10-21T12:00:00+08:00',paid:'无投放',confirmed:true,selections:[{line:2,publicationId:pub.id}],columns};assert.equal((await call('/douyin/import',body)).ok,1);assert.equal((await call('/douyin/import',body)).duplicates,1);const imports=await call('/analytics/imports');assert.equal(imports[0].blob_hash,preview.original.hash);
    await stop();await start();const saved=await call('/analytics/publications/'+pub.id);assert.equal(saved.snapshots.length,1);assert.equal(saved.snapshots[0].values.find(v=>v.metric_key==='completion').value,100);
    const job=await call('/backups',{});let done;for(let i=0;i<200;i++){done=(await call('/jobs')).find(j=>j.id===job.id);if(['成功','失败'].includes(done?.status))break;await delay(50);}assert.equal(done.status,'成功',done.error);const archive=path.join(dir,'backups',done.result.filename),inspected=await inspectBackup(archive,path.join(root,'inspect')),restored=await restoreInspected(inspected,path.join(root,'restored'),{confirm:true});assert.ok((await fs.readFile(path.join(restored.dataDirectory,'blobs',preview.original.hash))).equals(bytes));
  }finally{await stop();await fs.rm(root,{recursive:true,force:true});}
},{timeout:30000});
