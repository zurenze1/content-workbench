import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('执行台HTTP：保存、拒绝失效版本、CSV下载与进程重启后恢复',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'execution-http-')),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const base='http://127.0.0.1:'+port;let proc,csrf,log='';
 async function start(){proc=spawn(process.execPath,['server/main.mjs','--data',dir,'--port',String(port)],{stdio:['ignore','pipe','pipe']});proc.stdout.on('data',b=>log+=b);proc.stderr.on('data',b=>log+=b);for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/bootstrap');if(r.ok){const b=await r.json();csrf=b.csrf;assert.equal(b.executionDesk,true);return;}}catch{}if(proc.exitCode!=null)throw Error(log);await pause(50);}throw Error('隔离服务未启动');}
 async function stop(){if(proc&&proc.exitCode==null){const done=new Promise(r=>proc.once('exit',r));proc.kill('SIGTERM');await done;}}
 async function call(url,body,method=body===undefined?'GET':'POST'){const r=await fetch(base+'/api'+url,{method,headers:{'x-workbench-csrf':csrf,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error),{status:r.status});return d;}
 try{
  await start();const t=await call('/topics',{title:'隔离执行台作品'}),draft={title:'隔离执行台作品',segments:[{id:'one',heading:'开头',narration:'测试“引号”,以及\n换行。',shot:'原片',subtitle:'标题',evidenceIds:[],startSec:0,endSec:6.5,transition:'硬切',audioNote:'钢琴渐入',executionState:'待剪辑'}]};
  const saved=await call('/topics/'+t.id+'/script',{draft},'PUT');const v=await call('/topics/'+t.id+'/versions',{label:'执行版'});draft.segments[0].transition='叠化';await call('/topics/'+t.id+'/script',{draft,revision:saved.revision},'PUT');await assert.rejects(()=>call('/topics/'+t.id+'/script',{draft,revision:saved.revision},'PUT'),e=>e.status===409);
  const r=await fetch(base+'/api/versions/'+v.id+'/export?format=csv');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^text\/csv/);assert.match(r.headers.get('content-disposition'),/\.csv/);const bytes=Buffer.from(await r.arrayBuffer());assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);assert.match(bytes.toString('utf8'),/"00:00","00:06.5"/);assert.match(bytes.toString('utf8'),/"硬切","钢琴渐入"/);assert.match(bytes.toString('utf8'),/测试“引号”,以及\n换行。/);
  await stop();await start();const restored=await call('/topics/'+t.id);assert.equal(restored.script.draft.segments[0].transition,'叠化');assert.equal(restored.script.draft.segments[0].audioNote,'钢琴渐入');assert.deepEqual(Buffer.from(await (await fetch(base+'/api/versions/'+v.id+'/export?format=csv')).arrayBuffer()),bytes);
 }finally{await stop();await fs.rm(dir,{recursive:true,force:true});}
});
