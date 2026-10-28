import {uid,now,text,parse,hash} from './store.mjs';
import {sourceUrl,fetchPublic} from './security.mjs';
import {saveBuffer} from './files.mjs';
import {shanghaiDay,Hot} from './hot.mjs';
import {normalizeEvent,saveEvent} from './public-events.mjs';
import {dateWindow,decorateDigest,newsChannel} from './discovery-media.mjs';

const date=v=>{const d=new Date(v);if(!v||!Number.isFinite(d.getTime())||d.getTime()>Date.now()+300000)throw new Error('请提供实际采集时间，不能填写未来时间');return d.toISOString();};
export function creators(store){
  const prefs=store.get('discovery.creators')||{};
  return store.db.prepare('SELECT * FROM accounts ORDER BY created_at').all().map(a=>({...a,follow:prefs[a.id]?.follow??a.role!=='自有',lastCheck:store.db.prepare('SELECT * FROM creator_checks WHERE account_id=? ORDER BY observed_at DESC,created_at DESC LIMIT 1').get(a.id)||null}));
}
export function saveCreator(store,b,id=null){
  if(id){const old=store.row('accounts',id);store.db.prepare('UPDATE accounts SET name=?,url=? WHERE id=?').run(text(b.name??old.name,100,true),b.url===undefined?old.url:sourceUrl(b.url),id);}
  else id=store.account({name:b.name,url:sourceUrl(text(b.url,4000,true)),role:'对标'}).id;
  const prefs=store.get('discovery.creators')||{};prefs[id]={follow:b.follow!==false};store.set('discovery.creators',prefs);return creators(store).find(a=>a.id===id);
}
export function normalizeComment(c){
  const videoUrl=sourceUrl(text(c.videoUrl,4000,true)),value=c.likes===''||c.likes==null?null:Number(c.likes);
  if(value!=null&&(!Number.isFinite(value)||value<0))throw new Error('点赞数必须来自真实观察；未知请留空');
  const body=text(c.text,10000,true),author=text(c.author,200),observedAt=date(c.observedAt);
  const likesLabel=text(c.likesLabel,60)||String(value??'未知');
  return {accountId:c.accountId||null,videoUrl,videoTitle:text(c.videoTitle,300)||'标题待补',commentUrl:c.commentUrl?sourceUrl(c.commentUrl):videoUrl,author,text:body,likes:value,likesLabel,observedAt,origin:text(c.origin,300,true),scope:text(c.scope,1000,true),commentKey:hash(videoUrl+'|'+(text(c.commentId,200)||author+'|'+body))};
}
export function comments(store,q={}){
  const w=dateWindow(q),clauses=[],params=[];
  if(w.from){clauses.push('observed_at>=?');params.push(w.from);}if(w.to){clauses.push('observed_at<?');params.push(w.to);}
  const conditions=clauses.length?' AND '+clauses.join(' AND '):'';
  const rows=store.db.prepare(`SELECT c.*,a.name creator FROM comment_observations c LEFT JOIN accounts a ON a.id=c.account_id WHERE c.rowid=(SELECT c2.rowid FROM comment_observations c2 WHERE c2.comment_key=c.comment_key${conditions.replaceAll('observed_at','c2.observed_at')} ORDER BY observed_at DESC,rowid DESC LIMIT 1)${conditions.replaceAll('observed_at','c.observed_at')} ORDER BY c.observed_at DESC,c.rowid DESC`).all(...params,...params);
  const result=rows.filter(c=>(!q.accountId||c.account_id===q.accountId)&&(!q.q||[c.text,c.author,c.video_title,c.creator].join(' ').toLowerCase().includes(String(q.q).toLowerCase()))&&(!q.videoUrl||c.video_url===q.videoUrl));
  if(q.sort==='likes')result.sort((a,b)=>shanghaiDay(new Date(b.observed_at)).localeCompare(shanghaiDay(new Date(a.observed_at)))||(b.likes??-1)-(a.likes??-1)||b.observed_at.localeCompare(a.observed_at));
  return result.slice(0,2000);
}
export function queueDigestImages(store,digest){
  if(!digest)return [];
  return digest.payload.news.map(n=>{const url=n.sources[0].url;const existing=store.db.prepare("SELECT id FROM jobs WHERE kind='news-image' AND json_extract(input,'$.url')=? AND status IN ('排队','处理中','等待重试')").get(url);return existing||store.job('news-image',{url,imageUrl:n.imageUrl||''});});
}
export async function importComments(store,dir,body){
  if(!Array.isArray(body.comments)||body.comments.length>1000)throw new Error('每批最多1000条实际评论');
  const rows=body.comments.map(normalizeComment);for(const c of rows)if(c.accountId)store.row('accounts',c.accountId);
  const raw=await saveBuffer(store,dir,Buffer.from(JSON.stringify(body,null,2)),'高赞评论采集记录.json');
  return store.transaction(()=>{let n=0;for(const c of rows)n+=Number(store.db.prepare('INSERT OR IGNORE INTO comment_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(uid(),c.commentKey,c.accountId,c.videoUrl,c.videoTitle,c.commentUrl,c.author,c.text,c.likes,c.likesLabel,c.observedAt,c.origin,c.scope,raw.hash,now()).changes);return {saved:n,received:rows.length,blobHash:raw.hash};});
}
export function latestDigest(store,day=shanghaiDay()){
  const row=store.db.prepare('SELECT * FROM daily_digests WHERE day=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(day);return row?{...row,payload:parse(row.payload)}:null;
}
export function dailyStatus(store){
  const cfg=store.get('discovery.automation')||{},latest=store.db.prepare('SELECT day,created_at FROM daily_digests ORDER BY day DESC,created_at DESC LIMIT 1').get();
  return {...cfg,latest:latest||null,state:cfg.linked?'已连接现有Codex每日任务 · 上海09:00':'尚未连接每日任务',note:'09:00开始执行，采集完成后入库；电脑与Codex需运行。未来定时投递以实际记录为准。'};
}
function newsItem(n){
  if(!Array.isArray(n.sources)||!n.sources.length||n.sources.length>10)throw new Error('每条热点必须有真实来源');
  return {channel:newsChannel(n),person:text(n.person,100),imageUrl:n.imageUrl?sourceUrl(n.imageUrl):'',title:text(n.title,300,true),category:text(n.category,80)||'公共热点',facts:text(n.facts,10000,true),analysis:text(n.analysis,5000),publishedAt:text(n.publishedAt,100),readScope:text(n.readScope,2000,true),sources:n.sources.map(s=>({name:text(s.name,200,true),url:sourceUrl(s.url)}))};
}
export async function ingestDaily(store,dir,body){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(body.day)||body.day>shanghaiDay()||shanghaiDay(new Date(body.day+'T12:00:00+08:00'))!==body.day)throw new Error('日报日期无效');
  const generatedAt=date(body.generatedAt),model=text(body.model,100,true);
  if(!Array.isArray(body.news)||body.news.length>50)throw new Error('热点最多50条');
  const news=body.news.map(newsItem),checks=(body.creatorChecks||[]).map(c=>{store.row('accounts',c.accountId);return {accountId:c.accountId,status:text(c.status,80,true),note:text(c.note,3000,true),url:sourceUrl(c.url),observedAt:date(c.observedAt)};});
  if(checks.length>200)throw new Error('单次最多200个博主检查记录');
  const normalized=(body.comments||[]).map(normalizeComment);if(normalized.length>1000)throw new Error('评论数量超限');for(const c of normalized)if(c.accountId)store.row('accounts',c.accountId);
  const eventItems=(body.events||[]).map(normalizeEvent);if(eventItems.length>100)throw new Error('单次最多100条活动');
  const checksum=hash(JSON.stringify(body)),old=store.db.prepare('SELECT id FROM daily_digests WHERE checksum=?').get(checksum);if(old)return {id:old.id,duplicate:true};
  const raw=await saveBuffer(store,dir,Buffer.from(JSON.stringify(body,null,2)),'Codex每日热点与评论.json');
  for(const e of eventItems)await saveEvent(store,dir,e,{rawHash:raw.hash,id:e.eventId||null});
  const commentResult=await importComments(store,dir,{comments:body.comments||[]});
  const delivery=store.transaction(()=>{
    const hot=new Hot(store),items=news.map(n=>{const key='codex-news:'+hash(n.sources[0].url+'|'+n.title),existing=store.db.prepare('SELECT event_id FROM hot_items WHERE dedup_key=?').get(key);let eventId=existing?.event_id;
      if(!eventId){const e=hot.manualEvent({title:n.title,summary:n.facts,lane:/AI|科技|工具/i.test(n.category)?'我的赛道':'重大公共热点'});eventId=e.id;store.db.prepare('INSERT INTO hot_items(id,event_id,dedup_key,url,title,summary,published_at,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?)').run(uid(),e.id,key,n.sources[0].url,n.title,n.facts,n.publishedAt,now(),now());store.db.prepare('UPDATE hot_events SET origin=?,notes=? WHERE id=?').run('Codex每日自动化',JSON.stringify({verified:n.readScope,whyRelevant:n.analysis}),e.id);}
      return {...n,eventId};});
    for(const c of checks)store.db.prepare('INSERT INTO creator_checks VALUES(?,?,?,?,?,?,?)').run(uid(),c.accountId,c.status,c.note,c.url,c.observedAt,now());
    const payload={day:body.day,generatedAt,model,news:items,commentCount:commentResult.received,creatorChecks:checks,note:text(body.note,5000)},id=uid();
    store.db.prepare('INSERT INTO daily_digests VALUES(?,?,?,?,?,?)').run(id,body.day,checksum,raw.hash,JSON.stringify(payload),now());
    store.set('discovery.lastDelivery',{id,day:body.day,at:now(),news:items.length,comments:commentResult.received});return {id,day:body.day,news:items.length,comments:commentResult,duplicate:false};
  });
  queueDigestImages(store,latestDigest(store,body.day));
  return delivery;
}
export async function collectPublicComments(store,dir,input,signal){
  const url=sourceUrl(text(input.url,4000,true)),response=await fetchPublic(url,{signal,maxBytes:10*1024*1024});
  const raw=await saveBuffer(store,dir,response.buffer,'评论页原始响应.html');
  // 只处理网页主动公开的 JSON-LD Comment，不生成签名、不使用浏览器Cookie。
  const {JSDOM}=await import('jsdom');const dom=new JSDOM(response.buffer.toString('utf8'));const found=[];
  const walk=(obj,depth=0)=>{if(!obj||depth>30)return;if(Array.isArray(obj)){for(const v of obj)walk(v,depth+1);return;}if(typeof obj!=='object')return;if(obj['@type']==='Comment'&&(obj.text||obj.description))found.push(obj);for(const [k,v] of Object.entries(obj))if(k!=='author')walk(v,depth+1);};
  for(const tag of dom.window.document.querySelectorAll('script[type="application/ld+json"]'))try{walk(JSON.parse(tag.textContent));}catch{}dom.window.close();
  if(!found.length)return {status:'部分完成',result:{rawHash:raw.hash,count:0,note:'当前公开页面未提供可读取评论。需要正常登录后由Codex浏览器读取，或使用已获权的平台接口；未绕过限制。'}};
  const rows=found.slice(0,200).map(c=>({videoUrl:url,videoTitle:input.title||'公开作品',accountId:input.accountId||null,commentUrl:c.url||url,author:typeof c.author==='object'?c.author.name||'':c.author||'',text:c.text||c.description,likes:null,observedAt:now(),origin:'公开网页JSON-LD评论',scope:'仅页面公开返回的评论；未获得点赞数，不标成高赞'}));
  return {status:'成功',result:await importComments(store,dir,{comments:rows})};
}
export function registerDiscovery(app,store,cfg){
  app.get('/api/discovery/creators',async()=>creators(store));
  app.get('/api/discovery/identity',async()=>store.get('discovery.collector')||{state:'尚未指定网页采集身份'});
  app.post('/api/discovery/creators',async req=>saveCreator(store,req.body));
  app.patch('/api/discovery/creators/:id',async req=>saveCreator(store,req.body,req.params.id));
  app.get('/api/discovery/daily',async req=>{
    const q=req.query;dateWindow(q);const day=q.day||shanghaiDay();
    const history=store.db.prepare('SELECT day,max(created_at) delivered_at FROM daily_digests GROUP BY day ORDER BY day DESC LIMIT 90').all();
    const days=q.from||q.to?history.filter(h=>(!q.from||h.day>=q.from)&&(!q.to||h.day<=q.to)).map(h=>h.day):[day];
    const editions=days.map(d=>decorateDigest(store,latestDigest(store,d))).filter(Boolean);
    return {day,digest:decorateDigest(store,latestDigest(store,day)),items:editions.flatMap(d=>d.payload.news.map(n=>({...n,day:d.day,generatedAt:d.payload.generatedAt}))).filter(n=>!q.channel||n.channel===q.channel),history,automation:dailyStatus(store),target:10};
  });
  app.post('/api/discovery/daily/images',async req=>({jobs:queueDigestImages(store,latestDigest(store,req.body?.day||shanghaiDay()))}));
  app.post('/api/discovery/daily',async req=>ingestDaily(store,cfg.dir,req.body));
  app.get('/api/discovery/comments',async req=>comments(store,req.query));
  app.post('/api/discovery/comments/import',async req=>importComments(store,cfg.dir,req.body));
  app.post('/api/discovery/comments/fetch',async req=>store.jobView(store.job('comments-fetch',{url:sourceUrl(text(req.body.url,4000,true)),accountId:req.body.accountId||null,title:text(req.body.title,300)})));
  app.post('/api/discovery/comments/:id/save',async req=>{const c=store.db.prepare('SELECT * FROM comment_observations WHERE id=?').get(req.params.id);if(!c)throw new Error('评论不存在');const r=store.createSource({title:'评论 · '+c.text.slice(0,50),url:c.comment_url,kind:'原话',rights:'仅作参考',state:'待核对',author:c.author,notes:`${c.origin}；点赞 ${c.likes_label}；采集 ${c.observed_at}；${c.scope}`,tags:['高赞评论','待核实']},'comment:'+c.comment_key);if(!r.duplicate)store.addVersion(r.source.id,{body:c.text,blobHash:c.blob_hash,filename:'评论采集原始记录.json',method:'用户从评论池保存原话',metadata:{videoUrl:c.video_url,likes:c.likes,observedAt:c.observed_at,scope:c.scope}});return {sourceId:r.source.id,duplicate:r.duplicate};});
}
