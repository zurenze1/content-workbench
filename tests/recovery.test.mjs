import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';
import {createGzip} from 'node:zlib';
import tar from 'tar-stream';
import {Store,now} from '../server/store.mjs';
import {config} from '../server/config.mjs';
import {saveBuffer} from '../server/files.mjs';
import {inspectBackup} from '../server/backup.mjs';
test('持久任务过期租约恢复：夹具模拟过期，真实worker重新执行',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-worker-')),cfg=config(['--data',root]),s=new Store(cfg.db);let child;try{const blob=await saveBuffer(s,root,Buffer.from('恢复后仍读取真实原文件'),'record.txt'),source=s.createSource({title:'任务恢复测试'}).source;s.addVersion(source.id,{blobHash:blob.hash,filename:'record.txt',status:'等待用户补充'});const job=s.job('parse-file',{hash:blob.hash,name:'record.txt',mime:'text/plain'},source.id);s.db.prepare("UPDATE jobs SET status='处理中',owner='expired-worker',lease_until=?,attempts=1 WHERE id=?").run('2020-01-01T00:00:00.000Z',job.id);child=spawn(process.execPath,['server/worker.mjs','--data',root],{stdio:'ignore'});let complete;for(let i=0;i<100;i++){complete=s.row('jobs',job.id);if(complete.status==='成功')break;await new Promise(r=>setTimeout(r,50));}assert.equal(complete.status,'成功');assert.equal(complete.attempts,2);assert.ok(s.latest(source.id).text.includes('读取真实原文件'));assert.equal(s.db.prepare('SELECT count(*) n FROM sources').get().n,1);}finally{if(child){child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}s.close();await fs.rm(root,{recursive:true,force:true});}});
async function archive(file,manifest,entries=[]){const pack=tar.pack(),output=pipeline(pack,createGzip(),createWriteStream(file));await new Promise((r,j)=>pack.entry({name:'manifest.json'},JSON.stringify(manifest),e=>e?j(e):r()));for(const [name,bytes] of entries)await new Promise((r,j)=>pack.entry({name},bytes,e=>e?j(e):r()));pack.finalize();await output;}
test('A20/A21 恢复拒绝目录穿越与错误字节，失败不写出目标外文件',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-bad-backup-'));try{const bad=path.join(root,'bad.tar.gz');await archive(bad,{format:'content-workbench-backup',version:1,files:[{name:'../outside',size:1,hash:'0'.repeat(64)}]});await assert.rejects(inspectBackup(bad,root),/清单无效/);await archive(bad,{format:'content-workbench-backup',version:1,counts:{sources:0},schema:'x',files:[{name:'workbench.sqlite',size:3,hash:'0'.repeat(64)}]},[['workbench.sqlite',Buffer.from('bad')]]);await assert.rejects(inspectBackup(bad,root),/字节校验失败/);assert.deepEqual((await fs.readdir(root)).filter(n=>n.startsWith('restore-')),[]);}finally{await fs.rm(root,{recursive:true,force:true});}});
