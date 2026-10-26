import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,parse} from '../server/store.mjs';
import {exportVersion} from '../server/export.mjs';
import {assignMaterialRole} from '../src/storyboard-model.ts';

test('提案素材角色与剪辑说明随草稿和快照保存，旧版本不被后续改动覆盖',()=>{
  const s=new Store(':memory:');
  try{
    const topic=s.topic({title:'提案隔离项目'});
    const refs=['主选原文','备选原文'].map(title=>{const source=s.createSource({title,rights:'仅作参考',url:'https://example.org/'+encodeURIComponent(title)}).source;const version=s.addVersion(source.id,{body:title,filename:title+'.txt'});s.link(topic.id,source.id);return {sourceId:source.id,versionId:version.id};});
    const draft={title:'提案脚本',segments:[{id:'one',narration:'保留原稿。',evidenceIds:[],editNote:'先用主选，停顿后切备选。',materials:[{...refs[0],role:'主选'},{...refs[1],role:'备选'}]}]};
    const saved=s.saveDraft(topic.id,{draft}),snapshot=s.snapshot(topic.id,'第一版提案');
    const export1=exportVersion(s,snapshot.id);
    assert.equal(saved.draft.segments[0].editNote,draft.segments[0].editNote);
    assert.equal(export1.json.draft.segments[0].materials[0].role,'主选');
    assert.ok(export1.markdown.includes('先用主选，停顿后切备选。'));
    assert.ok(export1.markdown.includes('主选 · 固定来源'));
    const changed=assignMaterialRole(saved.draft.segments[0].materials,refs[1].versionId,'主选');
    assert.deepEqual(changed.map(x=>x.role),['备选','主选']);
    s.saveDraft(topic.id,{draft:{...saved.draft,segments:[{...saved.draft.segments[0],materials:changed,editNote:'第二版安排'}]},revision:saved.revision});
    s.updateSource(refs[0].sourceId,{title:'更改后的标题',rights:'不可使用'});
    const old=exportVersion(s,snapshot.id);
    assert.equal(old.json.draft.segments[0].materials[0].role,'主选');
    assert.equal(old.json.draft.segments[0].editNote,draft.segments[0].editNote);
    assert.equal(old.json.materials[refs[0].versionId].source.title,'主选原文');
    assert.equal(old.json.materials[refs[0].versionId].source.rights,'仅作参考');
  }finally{s.close();}
});

test('拒绝多个主选、未知角色和超长说明；旧引用不增加虚构用途',()=>{
  const s=new Store(':memory:');
  try{
    const topic=s.topic({title:'兼容旧分镜'}),refs=['a','b'].map(title=>{const source=s.createSource({title}).source;const v=s.addVersion(source.id,{body:title});s.link(topic.id,source.id);return {sourceId:source.id,versionId:v.id};});
    const row={id:'one',narration:'原有正文',evidenceIds:[],materials:refs};
    const saved=s.saveDraft(topic.id,{draft:{title:'旧分镜',segments:[row]}});
    assert.deepEqual(saved.draft.segments[0].materials,refs);
    assert.equal(Object.hasOwn(saved.draft.segments[0],'editNote'),false);
    const reject=patch=>assert.throws(()=>s.saveDraft(topic.id,{draft:{title:'旧分镜',segments:[{...row,...patch}]},revision:saved.revision}));
    reject({materials:refs.map(r=>({...r,role:'主选'}))});
    reject({materials:[{...refs[0],role:'AI猜测'}]});
    reject({editNote:'x'.repeat(4001)});
    reject({editNote:{text:'错误类型'}});
    assert.equal(s.draft(topic.id).revision,saved.revision);
    assert.equal(parse(s.db.prepare('SELECT draft FROM scripts WHERE topic_id=?').get(topic.id).draft).segments[0].narration,'原有正文');
  }finally{s.close();}
});
