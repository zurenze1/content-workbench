import {now,text,parse,uid} from './store.mjs';
import {Hot,LANES,SCREENS,LIFECYCLES,JUDGEMENTS,HOT_RIGHTS,shanghaiDay,shanghaiTime} from './hot.mjs';
import {Create,DIMENSIONS,MATERIALS,PLAN_STATES,validZone} from './create.mjs';
import {Analytics,SCALES,EXP_STATES,PAID} from './analytics.mjs';
import {modelConfig,setModelConfig,queueModel,modelCalls,MODEL_TASKS} from './model.mjs';
import {saveBuffer} from './files.mjs';
export function services(store,dir){const m=modelConfig(store,dir),feeds=store.db.prepare('SELECT count(*) n,sum(enabled) e FROM feeds').get(),b=new Hot(store).brief();return {model:{state:m.state,enabled:m.state==='已启用',provider:m.provider,model:m.model},push:{state:'外部渠道未配置（仅站内简报）',enabled:false},douyin:{state:'待授权 / 未接入',enabled:false},transcription:{state:'未接入',enabled:false},rssSchedule:{state:feeds.e?`${feeds.e} 个订阅定时运行（需本机服务开启）`:feeds.n?'订阅已添加，定时未开启':'未添加订阅源',enabled:!!feeds.e},brief:{state:b.enabled?`每天 ${b.time} 生成站内简报`:'每日简报未开启',enabled:b.enabled}};}
export function enums(){return {lanes:LANES,screens:SCREENS,lifecycles:LIFECYCLES,judgements:JUDGEMENTS,hotRights:HOT_RIGHTS,dimensions:DIMENSIONS,materials:MATERIALS,planStates:PLAN_STATES,scales:SCALES,expStates:EXP_STATES,paid:PAID,modelTasks:MODEL_TASKS};}
export function register(app,store,cfg){const hot=new Hot(store),create=new Create(store),ana=new Analytics(store),db=store.db;const big={bodyLimit:25*1024*1024};
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
  app.get('/api/calendar.ics',async(req,reply)=>{reply.header('Content-Type','text/calendar; charset=utf-8').header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent('发布日历.ics')}`);return create.ics();});
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
