import {now,text,parse,uid} from './store.mjs';
import {Hot,LANES,SCREENS,LIFECYCLES,JUDGEMENTS,HOT_RIGHTS,shanghaiDay,shanghaiTime} from './hot.mjs';
import {Create,DIMENSIONS,MATERIALS,PLAN_STATES,validZone} from './create.mjs';
import {Analytics,SCALES,EXP_STATES,PAID} from './analytics.mjs';
import {modelConfig,setModelConfig,queueModel,modelCalls,MODEL_TASKS} from './model.mjs';
import {saveBuffer,saveBlob,safeName} from './files.mjs';
import {OCR_ENGINE} from './ocr.mjs';
import {Variants,VARIANT_STATES} from './variants.mjs';
import {transcriptionStatus} from './transcription.mjs';
import {dailyStatus} from './discovery.mjs';
import {registerDouyin,douyinStatus} from './douyin.mjs';
export function services(store,dir){const m=modelConfig(store,dir),feeds=store.db.prepare('SELECT count(*) n,sum(enabled) e FROM feeds').get(),b=new Hot(store).brief();return {model:{state:m.state,enabled:m.state==='已启用',provider:m.provider,model:m.model},push:{state:'外部渠道未配置（仅站内简报）',enabled:false},douyin:douyinStatus(),transcription:transcriptionStatus(),daily:dailyStatus(store),rssSchedule:{state:feeds.e?`${feeds.e} 个订阅定时运行（需本机服务开启）`:feeds.n?'订阅已添加，定时未开启':'未添加订阅源',enabled:!!feeds.e},brief:{state:b.enabled?`每天 ${b.time} 生成站内简报`:'每日简报未开启',enabled:b.enabled}};}
export function enums(){return {lanes:LANES,screens:SCREENS,lifecycles:LIFECYCLES,judgements:JUDGEMENTS,hotRights:HOT_RIGHTS,dimensions:DIMENSIONS,materials:MATERIALS,planStates:PLAN_STATES,scales:SCALES,expStates:EXP_STATES,paid:PAID,modelTasks:MODEL_TASKS,variantStates:VARIANT_STATES};}
export function register(app,store,cfg){const hot=new Hot(store),create=new Create(store),ana=new Analytics(store),db=store.db;const big={bodyLimit:25*1024*1024};
  registerDouyin(app,store,cfg);
  app.put('/api/settings',async req=>{const b=req.body||{};if(b.publishTimezone)store.set('publishTimezone',validZone(text(b.publishTimezone,60)));if(b.uiTimezone)store.set('uiTimezone',validZone(text(b.uiTimezone,60)));return {publishTimezone:store.get('publishTimezone')||'Asia/Shanghai',uiTimezone:store.get('uiTimezone')||'Asia/Shanghai'};});
  // P2 热点与简报
  app.get('/api/hot/feeds',async()=>hot.feeds());
  app.post('/api/hot/feeds',async req=>hot.feed(req.body||{}));
  app.patch('/api/hot/feeds/:id',async req=>hot.feed(req.body||{},req.params.id));
  app.post('/api/hot/feeds/:id/run',async req=>hot.queueFeed(req.params.id));
  app.get('/api/hot/events',async req=>hot.events(req.query));
  app.post('/api/hot/events',async req=>hot.manualEvent(req.body||{}));
  app.get('/api/hot/events/:id',async req=>hot.event(req.params.id));
  app.patch('/api/hot/events/:id',async req=>hot.update(req.params.id,req.body||{}));
  app.post('/api/hot/events/:id/observations',async req=>hot.observe(req.params.id,req.body||{}));
  app.post('/api/hot/events/:id/merge',async req=>hot.merge(req.params.id,text(req.body?.into,100,true)));
  app.post('/api/hot/items/:id/split',async req=>hot.split(req.params.id));
  app.post('/api/hot/events/:id/topic',async req=>hot.toTopic(req.params.id,req.body||{}));
  app.get('/api/briefs',async()=>({settings:hot.brief(),briefs:hot.briefs()}));
  app.put('/api/briefs/settings',async req=>hot.setBrief(req.body||{}));
  app.post('/api/briefs/now',async()=>{const day=shanghaiDay();return hot.makeBrief(day,'',{manual:true});});
  // P3 参考拆解、排期、模型
  app.get('/api/refs',async()=>create.refs());
  app.post('/api/refs',async req=>create.ref(req.body||{}));
  app.patch('/api/refs/:id',async req=>create.ref(req.body||{},req.params.id));
  app.post('/api/refs/:id/topics',async req=>create.linkRef(req.params.id,text(req.body?.topicId,100,true),req.body?.remove===true));
  app.get('/api/calendar',async req=>create.calendar(req.query.from,req.query.to));
  app.post('/api/plans',async req=>create.plan(req.body||{}));
  app.patch('/api/plans/:id',async req=>create.plan(req.body||{},req.params.id));
  app.get('/api/calendar.ics',async(req,reply)=>{reply.header('Content-Type','text/calendar; charset=utf-8').header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent('发布日历.ics')}`);return create.ics(req.query.account||null);});
  app.get('/api/model',async()=>modelConfig(store,cfg.dir));
  app.put('/api/model',async req=>setModelConfig(store,cfg.dir,req.body||{}));
  app.get('/api/topics/:id/model',async req=>modelCalls(store,req.params.id));
  app.post('/api/topics/:id/model',async req=>queueModel(store,cfg.dir,req.params.id,req.body?.task));
  // P4 数据复盘
  app.get('/api/metrics',async()=>ana.defs());
  app.post('/api/metrics',async req=>ana.addDef(req.body||{}));
  app.get('/api/analytics/settings',async()=>ana.settings());
  app.put('/api/analytics/settings',async req=>ana.setSettings(req.body||{}));
  app.post('/api/analytics/preview',big,async req=>ana.preview(text(req.body?.content,20000000,true),req.body?.format));
  app.post('/api/analytics/import',big,async req=>{const b=req.body||{};ana.preview(text(b.content,20000000,true),b.format);const blob=await saveBuffer(store,cfg.dir,Buffer.from(b.content),(text(b.filename,150)||'导入数据')+(b.format==='json'?'.json':'.csv'));return ana.commit(b,blob);});
  app.get('/api/analytics/imports',async()=>db.prepare('SELECT * FROM data_imports ORDER BY created_at DESC LIMIT 50').all().map(i=>({...i,mapping:parse(i.mapping),errors:parse(i.errors||'[]')})));
  app.post('/api/analytics/snapshots',async req=>ana.manual(req.body||{}));
  app.post('/api/analytics/snapshots/:id/retention',async req=>ana.retention(req.params.id,req.body||{}));
  app.get('/api/analytics/publications',async()=>ana.publications().map(p=>({...p,snapshots:db.prepare('SELECT count(*) n FROM metric_snapshots WHERE publication_id=? AND superseded_by IS NULL').get(p.id).n,reviews:db.prepare('SELECT count(*) n FROM reviews WHERE publication_id=?').get(p.id).n})));
  app.get('/api/analytics/publications/:id',async req=>ana.publication(req.params.id));
  app.put('/api/analytics/publications/:id/alignment',async req=>ana.setAlignment(req.params.id,req.body||{}));
  app.post('/api/analytics/publications/:id/reviews',async req=>ana.review(req.params.id,req.body||{}));
  app.get('/api/analytics/timing',async req=>ana.timing(req.query));
  app.get('/api/experiments',async()=>ana.experiments());
  app.post('/api/experiments',async req=>ana.experiment(req.body||{}));
  app.patch('/api/experiments/:id',async req=>ana.experiment(req.body||{},req.params.id));
  app.post('/api/experiments/:id/topic',async req=>ana.experimentTopic(req.params.id,req.body||{}));
  // 一稿多发：同一选题的多平台版本
  const vs=new Variants(store);
  app.get('/api/platforms',async()=>vs.platforms());
  app.put('/api/platforms',async req=>vs.setPlatforms(req.body?.platforms));
  app.get('/api/variants',async()=>vs.overview());
  app.get('/api/topics/:id/variants',async req=>vs.list(req.params.id));
  app.post('/api/topics/:id/variants',async req=>vs.create(req.params.id,req.body||{}));
  app.patch('/api/variants/:id',async req=>vs.update(req.params.id,req.body||{}));
  app.post('/api/variants/:id/regenerate',async req=>vs.regenerate(req.params.id));
  app.post('/api/variants/:id/copy',async req=>vs.copy(req.params.id));
  app.post('/api/variants/:id/plan',async req=>vs.plan(req.params.id,req.body||{}));
  app.post('/api/variants/:id/publish',async req=>vs.publish(req.params.id,req.body||{}));
  // 后台截图 + 本机文字识别：识别结果只是候选值，人工核对确认后才写入数据快照
  const shotView=s=>({...s,ocr:s.ocr?parse(s.ocr):null,removed:!!s.removed});
  app.get('/api/analytics/publications/:id/screenshots',async req=>{store.row('publications',req.params.id);return db.prepare('SELECT * FROM data_screenshots WHERE publication_id=? AND removed=0 ORDER BY created_at').all(req.params.id).map(shotView);});
  app.post('/api/analytics/publications/:id/screenshots',async req=>{const pub=store.row('publications',req.params.id);if(db.prepare('SELECT count(*) n FROM data_screenshots WHERE publication_id=? AND removed=0').get(pub.id).n>=8)throw new Error('每条作品最多保留8张后台截图');const part=await req.file({limits:{fileSize:8*1024*1024}});if(!part)throw new Error('请选择截图');const name=safeName(part.filename||'后台截图.png');if(!/\.(png|jpe?g|webp)$/i.test(name))throw new Error('只支持 PNG / JPG / WebP 截图');const blob=await saveBlob(store,cfg.dir,part.file,name,8*1024*1024);if(part.file.truncated)throw new Error('截图超过8MB，未保存');if(!blob.mime.startsWith('image/'))throw new Error('文件内容不是图片');const id=uid(),at=now();return store.transaction(()=>{db.prepare('INSERT INTO data_screenshots(id,publication_id,blob_hash,filename,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,pub.id,blob.hash,name,'待识别',at,at);store.job('ocr',{screenshotId:id});return shotView(db.prepare('SELECT * FROM data_screenshots WHERE id=?').get(id));});});
  app.post('/api/screenshots/:id/ocr',async req=>{const s=db.prepare('SELECT * FROM data_screenshots WHERE id=? AND removed=0').get(req.params.id);if(!s)throw Object.assign(new Error('未找到截图'),{statusCode:404});db.prepare("UPDATE data_screenshots SET status='待识别',updated_at=? WHERE id=?").run(now(),s.id);store.job('ocr',{screenshotId:s.id});return {ok:true,engine:OCR_ENGINE};});
  app.delete('/api/screenshots/:id',async req=>{db.prepare('UPDATE data_screenshots SET removed=1,updated_at=? WHERE id=?').run(now(),req.params.id);return {ok:true,note:'截图已移出列表；原图仍在资料库存储中，已录入的数字不受影响'};});
  app.post('/api/analytics/publications/:id/screenshots/confirm',async req=>{const b=req.body||{},ids=Array.isArray(b.screenshotIds)?b.screenshotIds:[];const shots=ids.map(id=>db.prepare('SELECT * FROM data_screenshots WHERE id=? AND publication_id=? AND removed=0').get(id,req.params.id));if(!shots.length||shots.some(s=>!s))throw new Error('请选择这条作品的截图作为依据');return store.transaction(()=>{const snap=ana.manual({...b,publication_id:req.params.id,note:[b.note,'依据截图：'+shots.map(s=>s.filename).join('、')].filter(Boolean).join('；')},'截图识别·人工确认');for(const s of shots)db.prepare('UPDATE data_screenshots SET snapshot_id=?,updated_at=? WHERE id=?').run(snap.id,now(),s.id);return snap;});});
  // P5 今日工作台：只汇总真实记录，没有数据时为空
  app.get('/api/today',async()=>{const at=new Date(),iso=at.toISOString(),day=shanghaiDay(at),week=new Date(at.getTime()+7*86400000).toISOString(),dayAgo=new Date(at.getTime()-86400000).toISOString();const b=db.prepare('SELECT * FROM briefs WHERE day=?').get(day);const cfgBrief=hot.brief();return {day,brief:b?hot.briefView(b):null,briefSettings:cfgBrief,briefDue:cfgBrief.enabled?shanghaiTime(day,cfgBrief.time).toISOString():null,
    hot:{fresh:db.prepare("SELECT count(*) n FROM hot_events WHERE first_seen_at>=? AND screen='待筛选'").get(dayAgo).n,starred:db.prepare("SELECT id,title,lane,lifecycle,judgement FROM hot_events WHERE starred=1 AND screen='待筛选' ORDER BY last_seen_at DESC LIMIT 5").all(),feedErrors:db.prepare("SELECT name,last_error,last_success_at FROM feeds WHERE last_error!=''").all()},
    topics:db.prepare("SELECT t.*,a.name account_name,(SELECT count(*) FROM topic_sources r WHERE r.topic_id=t.id) sources,(SELECT count(*) FROM topic_sources r JOIN sources s ON s.id=r.source_id WHERE r.topic_id=t.id AND s.verification='未核验') unverified FROM topics t LEFT JOIN accounts a ON a.id=t.account_id WHERE t.stage NOT IN ('发布','归档') ORDER BY t.updated_at DESC LIMIT 8").all(),
    verify:{count:db.prepare("SELECT count(*) n FROM sources WHERE verification='未核验' AND state IN ('待整理','待核对')").get().n,items:db.prepare("SELECT id,title,kind,state FROM sources WHERE verification='未核验' AND state IN ('待整理','待核对') ORDER BY updated_at DESC LIMIT 5").all()},
    plans:{upcoming:db.prepare("SELECT * FROM publish_plans WHERE planned_at BETWEEN ? AND ? AND status IN ('筹备中','待发布') ORDER BY planned_at").all(iso,week).map(p=>create.planView(p)),overdue:db.prepare("SELECT * FROM publish_plans WHERE planned_at<? AND status IN ('筹备中','待发布') ORDER BY planned_at").all(iso).map(p=>create.planView(p))},
    reviews:{noData:db.prepare("SELECT p.*,t.title topic_title FROM publications p JOIN topics t ON t.id=p.topic_id WHERE p.published_at<? AND NOT EXISTS(SELECT 1 FROM metric_snapshots s WHERE s.publication_id=p.id) ORDER BY p.published_at DESC LIMIT 10").all(dayAgo),noReview:db.prepare("SELECT p.*,t.title topic_title FROM publications p JOIN topics t ON t.id=p.topic_id WHERE EXISTS(SELECT 1 FROM metric_snapshots s WHERE s.publication_id=p.id) AND NOT EXISTS(SELECT 1 FROM reviews r WHERE r.publication_id=p.id) LIMIT 10").all()},
    experiments:db.prepare("SELECT e.*,t.title topic_title FROM experiments e LEFT JOIN topics t ON t.id=e.topic_id WHERE e.status IN ('待测试','进行中') ORDER BY e.updated_at DESC LIMIT 8").all(),
    jobs:{failed:db.prepare("SELECT count(*) n FROM jobs WHERE status='失败' AND updated_at>=?").get(new Date(at.getTime()-7*86400000).toISOString()).n,running:db.prepare("SELECT count(*) n FROM jobs WHERE status IN ('排队','处理中','等待重试')").get().n}};});
}
