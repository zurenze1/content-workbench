import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';
import {Analytics} from '../server/analytics.mjs';
import {parseDouyinExport,previewDouyin,commitDouyin} from '../server/douyin.mjs';
import {douyinFixture} from './fixtures/douyin-xlsx.mjs';

function setup(){const store=new Store(':memory:'),ana=new Analytics(store),account=store.account({name:'合成测试账号',role:'自有'}),topic=store.topic({title:'合成测试作品A',account_id:account.id});store.saveDraft(topic.id,{draft:{title:topic.title,segments:[{id:'a',heading:'正文',narration:'这是隔离测试，非真实运营数据',evidenceIds:[]}]}});const version=store.snapshot(topic.id,'测试版'),publication=store.publish(topic.id,{versionId:version.id,url:'https://example.org/synthetic-douyin',publishedAt:'2026-10-20T12:00:00+08:00'});return {store,ana,account,publication};}
function bodyFor(preview,account,publication){return {accountId:account.id,capturedAt:'2026-10-21T12:00:00+08:00',paid:'无投放',confirmed:true,selections:[{line:2,publicationId:publication.id}],columns:{...preview.columns,'平均播放时长':{metric:'avg_watch_sec',scale:'分:秒'}}};}
const blob={name:'合成测试导出.xlsx',hash:null};

test('抖音Excel：活动工作表、共享/内联文本、真实0与空值、百分比1边界',()=>{
  for(const shared of [false,true]){const p=parseDouyinExport(douyinFixture({shared}));assert.equal(p.sheet,'合成后台导出');assert.equal(p.rows.length,2);assert.equal(p.rows[0].raw['作品名称'],'合成测试作品A');assert.equal(p.rows[0].raw['播放量'],'0');assert.equal(p.rows[0].raw['点赞量'],'');assert.equal(p.rows[0].raw['完播率'],'1');assert.ok(p.rows[0].percentColumns.includes('完播率'));}
});
test('抖音字段：5s完播不映射CTR，粉丝增量不猜口径，单位需要明确',()=>{
  const {store,ana}=setup();try{const p=previewDouyin(douyinFixture(),ana);assert.equal(p.columns['5s完播率'].metric,'retention5s');assert.equal(p.columns['封面点击率'].metric,'ctr');assert.equal(p.columns['粉丝增量'].metric,undefined);assert.equal(p.columns['完播率'].scale,'小数比例（0.35表示35%）');assert.equal(p.rows[0].suggestedPublicationIds.length,1);const raw=previewDouyin(douyinFixture({headers:['作品名称','播放量','完播率'],rows:[['A',10,.3]]}),ana);assert.equal(raw.columns['完播率'].scale,'');}finally{store.close();}
});
test('抖音导入：确认、同账号约束、原值、分秒、100%与重复快照',()=>{
  const {store,ana,account,publication}=setup();try{const bytes=douyinFixture(),preview=previewDouyin(bytes,ana),parsed=parseDouyinExport(bytes),body=bodyFor(preview,account,publication);assert.throws(()=>commitDouyin(parsed,ana,{...body,confirmed:false},blob),/确认/);assert.equal(store.db.prepare('SELECT count(*) n FROM metric_snapshots').get().n,0);const result=commitDouyin(parsed,ana,body,blob);assert.equal(result.ok,1);assert.equal(result.unselected,1);let snap=ana.snapshotView(ana.latest(publication.id)[0]),values=Object.fromEntries(snap.values.map(v=>[v.metric_key,v]));assert.equal(values.views.value,0);assert.equal(values.likes.value,null);assert.equal(values.completion.value,100);assert.equal(values.completion.raw_value,'1');assert.equal(values.retention5s.value,50);assert.equal(values.ctr.value,12);assert.equal(values.avg_watch_sec.value,65);assert.equal(snap.window_hours,24);assert.equal(snap.retention.length,0);assert.equal(commitDouyin(parsed,ana,body,blob).duplicates,1);assert.equal(store.db.prepare('SELECT count(*) n FROM metric_snapshots').get().n,1);const other=store.account({name:'另一个合成账号',role:'自有'});assert.throws(()=>commitDouyin(parsed,ana,{...body,accountId:other.id},blob),/不属于/);const benchmark=store.account({name:'对标',role:'对标'});assert.throws(()=>commitDouyin(parsed,ana,{...body,accountId:benchmark.id},blob),/自有或获授权/);assert.throws(()=>commitDouyin(parsed,ana,{...body,capturedAt:'2026-10-19T00:00:00+08:00'},blob),/晚于/);assert.equal(store.db.prepare('SELECT count(*) n FROM metric_snapshots').get().n,1);}finally{store.close();}
});
test('抖音解析拒绝登录错误、畸形表头与错误数值，失败不写快照',()=>{
  assert.throws(()=>parseDouyinExport(Buffer.from('{"BaseResp":{"StatusCode":8}}')),/不是有效xlsx/);
  assert.throws(()=>parseDouyinExport(douyinFixture({headers:['作品名称','播放量','播放量']})),/重名/);
  assert.throws(()=>parseDouyinExport(douyinFixture({headers:['作品名称','播放量','']})),/空白/);
  const {store,ana,account,publication}=setup();try{const bytes=douyinFixture({headers:['作品名称','播放量','完播率'],rows:[['合成测试作品A','not-a-number','35%']]}),p=previewDouyin(bytes,ana);assert.throws(()=>commitDouyin(parseDouyinExport(bytes),ana,{...bodyFor(p,account,publication),columns:p.columns},blob),/不是数字/);assert.equal(store.db.prepare('SELECT count(*) n FROM metric_snapshots').get().n,0);}finally{store.close();}
});
test('Excel日期、公式缓存和超长作品ID原文保留',()=>{const p=parseDouyinExport(douyinFixture({headers:['作品名称','播放量','发布时间','作品ID'],rows:[['合成',{n:3,formula:'1+2'},{n:1,s:2},'9000000000000000001']],date1904:true}));assert.equal(p.rows[0].raw['发布时间'],'1904-01-02 00:00:00');assert.equal(p.rows[0].raw['作品ID'],'9000000000000000001');assert.ok(p.rows[0].formulaColumns.includes('播放量'));});
