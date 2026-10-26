import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';
import {originalFiles} from '../server/workspace.mjs';
import {connectionTest,queueConnectionTest} from '../server/studio.mjs';

test('原件明细：内容去重、稳定分页、文件名检索及字面通配符',()=>{
  const s=new Store(':memory:');try{
    for(let i=0;i<45;i++)s.db.prepare('INSERT INTO blobs VALUES(?,?,?,?)').run(i.toString(16).padStart(64,'0'),100+i,i%2?'video/mp4':'text/plain','2026-10-26T00:00:00Z');
    const first=originalFiles(s),last=originalFiles(s,{offset:40});
    assert.equal(first.total,45);assert.equal(first.items.length,40);assert.equal(last.items.length,5);assert.equal(new Set([...first.items,...last.items].map(f=>f.hash)).size,45);
    assert.equal(originalFiles(s,{q:'video/mp4'}).total,22);
    const source=s.createSource({title:'有出处的文件',kind:'文档'}).source;
    s.addVersion(source.id,{blobHash:'0'.repeat(64),filename:'100%_真实原件.txt',body:'原件对应的文字'});
    s.addVersion(source.id,{blobHash:'0'.repeat(64),filename:'100%_真实原件.txt',body:'历史同文件引用'});
    const named=originalFiles(s,{q:'100%_'});assert.equal(named.total,1);assert.equal(named.items[0].name,'100%_真实原件.txt');
    s.db.prepare('INSERT INTO data_imports VALUES(?,?,?,?,?,?,?,?,?,?)').run('import','后台独立原表.xlsx','1'.padStart(64,'0'),'json','{}','成功',1,1,'[]','2026-10-26T00:00:00Z');
    assert.equal(originalFiles(s,{q:'后台独立原表'}).items[0].name,'后台独立原表.xlsx');
    assert.equal(originalFiles(s,{q:"' OR 1=1 --"}).total,0);assert.equal(originalFiles(s,{offset:-9}).offset,0);assert.equal(originalFiles(s,{offset:'bad'}).offset,0);assert.equal(originalFiles(s,{offset:99999999}).items.length,0);
    assert.equal(s.db.prepare('SELECT count(*) n FROM blobs').get().n,45,'读取不改原件数量');
  }finally{s.close();}
});

test('连接测试：无测试记录不冒充成功，真实任务失败和取消如实呈现，不泄露其他对话',()=>{
  const s=new Store(':memory:');try{
    assert.equal(connectionTest(s),null);
    const j=s.job('studio-chat',{});s.set('studio.connectionTest',{conversationId:'test',jobId:j.id,model:'test-model',startedAt:'2026-10-26T00:00:00Z'});
    s.set('studio.conversations',[{id:'private',messages:[{content:'不可带入的项目内容'}]},{id:'test',messages:[{role:'assistant',jobId:j.id,status:'排队',content:''}]}]);
    assert.equal(connectionTest(s).status,'排队');assert.equal(JSON.stringify(connectionTest(s)).includes('不可带入'),false);
    assert.equal(queueConnectionTest(s,'/unused').jobId,j.id,'重复点击不追加正在运行的测试');
    s.db.prepare("UPDATE jobs SET status='失败',error='实际服务不可用' WHERE id=?").run(j.id);assert.equal(connectionTest(s).status,'失败');assert.equal(connectionTest(s).error,'实际服务不可用');
    s.db.prepare("UPDATE jobs SET status='已取消' WHERE id=?").run(j.id);assert.equal(connectionTest(s).status,'已取消');
    s.set('studio.connectionTest',{conversationId:'missing',jobId:'missing'});assert.equal(connectionTest(s).status,'记录缺失');
  }finally{s.close();}
});
