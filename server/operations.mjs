import fsp from 'node:fs/promises';
import {zipSync,strToU8} from 'fflate';
import {uid,now,text,choice,parse,hash} from './store.mjs';
import {Hot} from './hot.mjs';
import {sourceUrl} from './security.mjs';
import {saveBuffer,blobPath,fileHash,safeName} from './files.mjs';
import {exportVersion} from './export.mjs';

export const PRODUCTION_PHASES=['选题','核资料','写稿','待审','需修改','已确认','制作','待发布','复盘','归档'];
export const OPPORTUNITY_STATES=['观察中','待补资料','准备创作','暂不跟进'];
const conflict=message=>Object.assign(new Error(message),{statusCode:409});
function revision(body,old){if(body.revision!==old.revision)throw conflict('内容已被其他窗口修改，请刷新后再保存。');}
function date(value){if(!value)return '';if(typeof value!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(new Date(value).getTime()))throw new Error('时间需要包含时区');return new Date(value).toISOString();}
function fields(body,old,keys){const out={...old};for(const key of keys)if(body[key]!==undefined)out[key]=text(body[key],5000);return out;}

export class Operations{
  constructor(store,dir){this.store=store;this.db=store.db;this.dir=dir;this.hot=new Hot(store);}
  account(id){const a=this.store.row('accounts',id);if(!['自有','获授权管理'].includes(a.role))throw new Error('对标账号仅供研究；请选择自己的账号或实际服务的IP。');return a;}
  profiles(){return this.db.prepare("SELECT a.*,p.payload,p.revision,p.updated_at FROM accounts a LEFT JOIN ip_profiles p ON p.account_id=a.id WHERE a.role IN ('自有','获授权管理') ORDER BY a.created_at").all().map(a=>({...a,profile:parse(a.payload),revision:a.revision||0}));}
  profile(id,body){const account=this.account(id);return this.store.transaction(()=>{
    const old=this.db.prepare('SELECT * FROM ip_profiles WHERE account_id=?').get(id);
    revision(body,old||{revision:0});
    const payload=fields(body,old?parse(old.payload):{},['positioning','audience','voice','boundaries','keywords','cadence','approver','authorization']);
    const name=text(body.name??account.name,100,true),url=body.url===undefined?account.url:body.url?sourceUrl(body.url):'';
    this.db.prepare('UPDATE accounts SET name=?,url=? WHERE id=?').run(name,url,id);
    this.db.prepare('INSERT INTO ip_profiles VALUES(?,?,1,?) ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload,revision=ip_profiles.revision+1,updated_at=excluded.updated_at').run(id,JSON.stringify(payload),now());
    return this.profiles().find(a=>a.id===id);
  });}
  context(body){const id=text(body.accountId,100);if(id)this.account(id);this.store.set('operationsContext',id);return {accountId:id};}
  event(topicId,kind,payload){this.db.prepare('INSERT INTO workflow_events VALUES(?,?,?,?,?)').run(uid(),topicId,kind,JSON.stringify(payload),now());}
  opportunity(eventId,body){this.store.row('hot_events',eventId);const account=this.account(body.accountId);return this.store.transaction(()=>{
    const old=this.db.prepare('SELECT * FROM opportunities WHERE event_id=? AND account_id=?').get(eventId,account.id);
    revision(body,old||{revision:0});
    const payload=fields(body,old?parse(old.payload):{},['fit','angle','needs','effort']);
    payload.expiresAt=body.expiresAt===undefined?(payload.expiresAt||''):date(body.expiresAt);
    const state=choice(body.state,OPPORTUNITY_STATES,old?.state||'观察中'),at=now();
    if(old)this.db.prepare('UPDATE opportunities SET payload=?,state=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(payload),state,at,old.id);
    else this.db.prepare('INSERT INTO opportunities(id,event_id,account_id,payload,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(uid(),eventId,account.id,JSON.stringify(payload),state,at,at);
    return this.opportunities().find(o=>o.event_id===eventId&&o.account_id===account.id);
  });}
  opportunities(){return this.db.prepare('SELECT o.*,e.title event_title,e.last_seen_at FROM opportunities o JOIN hot_events e ON e.id=o.event_id ORDER BY o.updated_at DESC').all().map(o=>({...o,...parse(o.payload)}));}
  convert(eventId,body){return this.store.transaction(()=>{
    const account=this.account(body.accountId),existing=this.db.prepare('SELECT * FROM opportunities WHERE event_id=? AND account_id=?').get(eventId,account.id);
    // 重试先返回已创建的选题，不能重复生成项目或覆盖较新的判断。
    if(existing?.topic_id)return {topic:this.store.row('topics',existing.topic_id),existing:true};
    const o=this.opportunity(eventId,body);if(o.state==='暂不跟进')throw new Error('请先将此IP的热点判断改为准备创作。');
    if(!o.fit||!o.angle)throw new Error('请填写与这个IP的关系和原创角度。');
    const e=this.hot.event(eventId),at=now(),brief=[`热点来源：${e.title}；首次采集 ${e.first_seen_at}；最近观察 ${e.last_seen_at}`,`目标IP：${account.name}`,`关联理由：${o.fit}`,`原创角度：${o.angle}`,`资料缺口：${o.needs||'待核对'}`,`制作投入：${o.effort||'待估计'}`,`时效判断截止：${o.expiresAt||'未设定'}`,`热点趋势：${e.lifecycle}（${e.lifecycle_reason}）`,`事实核对：${e.notes.verified||'尚未人工核实'}；使用权限：${e.rights}`].join('\n');
    const topic=this.store.topic({title:text(body.title,200)||e.title,account_id:account.id,brief,stage:'选题'}),jobs=[];
    for(const item of e.items){if(!item.url)continue;const {source,duplicate}=this.store.createSource({url:item.url,title:item.title,notes:'热点报道发布时间：'+(item.published_at||'未知')},'url:'+hash(item.url));
      if(!duplicate){this.store.addVersion(source.id,{status:'等待用户补充',method:'热点原始网址已保存',metadata:{hotEventId:eventId}});jobs.push(this.store.job('fetch',{url:item.url,customTitle:true},source.id).id);}
      this.store.link(topic.id,source.id);
    }
    this.db.prepare("UPDATE opportunities SET topic_id=?,state='准备创作',revision=revision+1,updated_at=? WHERE id=?").run(topic.id,at,o.id);
    // 保留旧版单选题入口，跨IP关系以opportunities为准。
    this.db.prepare("UPDATE hot_events SET topic_id=coalesce(topic_id,?),screen='已选用',updated_at=? WHERE id=?").run(topic.id,at,eventId);
    this.event(topic.id,'热点转选题',{eventId,accountId:account.id,opportunityId:o.id,fit:o.fit,angle:o.angle});
    return {topic,jobs,existing:false};
  });}
  version(topicId,id){const version=this.store.row('script_versions',id),script=this.store.row('scripts',version.script_id);if(script.topic_id!==topicId)throw new Error('这个脚本版本不属于当前项目。');return {...version,payload:parse(version.payload)};}
  current(topicId,version){const draft=this.store.draft(topicId),topic=this.store.row('topics',topicId);return !!draft&&JSON.stringify(draft.draft)===JSON.stringify(version.payload.draft)&&(version.payload.topic.account_id||null)===(topic.account_id||null);}
  production(topicId){const t=this.store.row('topics',topicId),p=this.db.prepare('SELECT * FROM productions WHERE topic_id=?').get(topicId);return p||{topic_id:topicId,phase:({素材:'核资料',定稿:'写稿',发布:'待发布',归档:'归档'}[t.stage]||'选题'),owner:'',due_at:'',next_action:'',adopted_version_id:null,revision:0};}
  updateProduction(topicId,body){return this.store.transaction(()=>{
    const old=this.production(topicId);revision(body,old);let phase=choice(body.phase,PRODUCTION_PHASES,old.phase);
    if(['待审','需修改','已确认','复盘'].includes(phase)&&phase!==old.phase)throw new Error('审稿状态由具体审阅记录产生；复盘从真实发布记录进入。');
    if(['制作','待发布'].includes(phase)&&!this.approved(topicId))throw new Error('请先确认当前脚本版本，再进入制作或待发布。');
    const due=body.dueAt===undefined?old.due_at:date(body.dueAt),owner=text(body.owner??old.owner,100),next=text(body.nextAction??old.next_action,2000),at=now();
    this.db.prepare('INSERT INTO productions(topic_id,phase,owner,due_at,next_action,revision,updated_at) VALUES(?,?,?,?,?,1,?) ON CONFLICT(topic_id) DO UPDATE SET phase=excluded.phase,owner=excluded.owner,due_at=excluded.due_at,next_action=excluded.next_action,revision=productions.revision+1,updated_at=excluded.updated_at').run(topicId,phase,owner,due,next,at);
    this.event(topicId,'推进项目',{phase,owner,dueAt:due,nextAction:next});return this.topic(topicId);
  });}
  phase(topicId,phase,versionId=null){const old=this.production(topicId);this.db.prepare('INSERT INTO productions(topic_id,phase,adopted_version_id,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(topic_id) DO UPDATE SET phase=excluded.phase,adopted_version_id=coalesce(excluded.adopted_version_id,productions.adopted_version_id),revision=productions.revision+1,updated_at=excluded.updated_at').run(topicId,phase,versionId,now());return old;}
  approved(topicId){const p=this.production(topicId);if(!p.adopted_version_id)return null;const v=this.version(topicId,p.adopted_version_id);if(!this.current(topicId,v))return null;const latest=this.db.prepare('SELECT * FROM approval_rounds WHERE topic_id=? AND version_id=? ORDER BY requested_at DESC,rowid DESC LIMIT 1').get(topicId,v.id);return latest?.status==='已确认'?latest:null;}
  requestReview(topicId,body){return this.store.transaction(()=>{
    const topic=this.store.row('topics',topicId);if(!topic.account_id)throw new Error('请先为项目指定账号或IP。');this.account(topic.account_id);
    const v=this.version(topicId,body.versionId);if(!v.payload.draft.segments.some(s=>s.narration.trim()))throw new Error('空白脚本不能提交审稿。');
    if(!this.current(topicId,v))throw conflict('草稿或IP归属已变化，请保存新的脚本快照再提交。');
    const reviewer=text(body.reviewer,100,true),pending=this.db.prepare("SELECT * FROM approval_rounds WHERE topic_id=? AND version_id=? AND reviewer=? AND status='待审'").get(topicId,v.id,reviewer);if(pending)return pending;
    // 新一轮提交使旧的待审轮次撤回，旧记录及意见保留。
    for(const r of this.db.prepare("SELECT id FROM approval_rounds WHERE topic_id=? AND status='待审'").all(topicId)){
      this.db.prepare("UPDATE approval_rounds SET status='已撤回',decided_at=?,note='新版本重新提交，旧轮次保留' WHERE id=?").run(now(),r.id);this.event(topicId,'撤回旧审稿',{reviewId:r.id});
    }
    const id=uid();this.db.prepare('INSERT INTO approval_rounds(id,topic_id,version_id,reviewer,requested_at) VALUES(?,?,?,?,?)').run(id,topicId,v.id,reviewer,now());
    this.phase(topicId,'待审');this.event(topicId,'提交审稿',{reviewId:id,versionId:v.id,reviewer});return this.db.prepare('SELECT * FROM approval_rounds WHERE id=?').get(id);
  });}
  decide(id,body){return this.store.transaction(()=>{
    const r=this.db.prepare('SELECT * FROM approval_rounds WHERE id=?').get(id);if(!r)throw new Error('未找到审稿轮次。');
    if(r.status!=='待审')throw conflict('这一轮已处理；重新审稿请提交新轮次。');
    const status=choice(body.status,['需修改','已确认','已撤回']),origin=choice(body.origin,['本人审阅','已收到IP意见','撤回提交']),note=text(body.note,5000,true);
    if(!status||!origin)throw new Error('请记录实际审阅结果、意见来源和说明。');
    const topic=this.store.row('topics',r.topic_id);if(status!=='已撤回'&&this.account(topic.account_id).role==='获授权管理'&&origin!=='已收到IP意见')throw new Error('服务IP的确认需要记录实际收到的IP意见。');
    if(status==='已确认'&&!this.current(r.topic_id,this.version(r.topic_id,r.version_id)))throw conflict('稿件已经修改，不能把旧轮次确认为当前采用版；请重新提交。');
    this.db.prepare('UPDATE approval_rounds SET status=?,decided_at=?,note=?,origin=? WHERE id=?').run(status,now(),note,origin,id);
    this.phase(r.topic_id,status==='已撤回'?'写稿':status,status==='已确认'?r.version_id:null);
    this.event(r.topic_id,'记录审稿结果',{reviewId:id,versionId:r.version_id,status,origin,note});return this.topic(r.topic_id);
  });}
  topic(id){const topic=this.store.row('topics',id),p=this.production(id),rounds=this.db.prepare('SELECT * FROM approval_rounds WHERE topic_id=? ORDER BY requested_at DESC,rowid DESC').all(id).map(r=>({...r,current:this.current(id,this.version(id,r.version_id))}));
    const publications=this.db.prepare('SELECT p.*,(SELECT count(*) FROM metric_snapshots m WHERE m.publication_id=p.id AND superseded_by IS NULL) snapshots,(SELECT count(*) FROM reviews r WHERE r.publication_id=p.id) reviews,(SELECT count(*) FROM experiments e WHERE e.publication_id=p.id) experiments FROM publications p WHERE topic_id=? ORDER BY published_at DESC').all(id).map(p=>{const windows=this.db.prepare('SELECT DISTINCT window_hours FROM metric_snapshots WHERE publication_id=? AND superseded_by IS NULL').all(p.id).map(s=>s.window_hours),elapsed=(Date.now()-new Date(p.published_at).getTime())/3600000;return {...p,windows,reviewDue:[24,72,168].filter(h=>elapsed>=h&&!windows.includes(h)),nextReview:[24,72,168].find(h=>elapsed<h)||null};});
    const approved=this.approved(id),stale=['待审','已确认','制作','待发布'].includes(p.phase)&&rounds.length&&!rounds[0].current;
    return {topic,production:p,displayPhase:p.phase==='归档'?'归档':publications.length?'复盘':stale?'写稿':p.phase,staleApproval:!!stale,approved,
      rounds,handoffs:this.db.prepare('SELECT * FROM handoffs WHERE topic_id=? ORDER BY created_at DESC').all(id).map(h=>({...h,payload:parse(h.payload)})),publications,
      opportunities:this.opportunities().filter(o=>o.topic_id===id),history:this.db.prepare('SELECT * FROM workflow_events WHERE topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50').all(id).map(e=>({...e,payload:parse(e.payload)}))};
  }
  summary(){const profiles=this.profiles(),ids=new Set(profiles.map(p=>p.id)),stored=this.store.get('operationsContext')||'',accountId=ids.has(stored)?stored:'';
    const topics=this.db.prepare('SELECT * FROM topics ORDER BY updated_at DESC').all().map(t=>{const p=this.topic(t.id);return {...t,...p.production,phase:p.displayPhase,staleApproval:p.staleApproval,pending:p.rounds.filter(r=>r.status==='待审'&&r.current).length,publications:p.publications.length,awaitingData:p.publications.filter(p=>p.reviewDue.length||!p.snapshots).length,awaitingReview:p.publications.filter(p=>p.snapshots&&!p.reviews).length,handoffs:p.handoffs.length};});
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),digest=this.db.prepare('SELECT day,created_at FROM daily_digests ORDER BY day DESC,created_at DESC LIMIT 1').get();
    return {accountId,profiles,topics,opportunities:this.opportunities(),phases:PRODUCTION_PHASES,opportunityStates:OPPORTUNITY_STATES,digest: digest?{...digest,today:digest.day===day}:null};
  }
  async handoff(topicId,body){const v=this.version(topicId,body.versionId),latest=this.db.prepare('SELECT * FROM approval_rounds WHERE topic_id=? AND version_id=? ORDER BY requested_at DESC,rowid DESC LIMIT 1').get(topicId,v.id),approved=latest?.status==='已确认'?latest:null;
    const exportData=exportVersion(this.store,v.id),refs=Object.values(v.payload.references),sourceVersions=[...new Map([...refs.map(e=>e.version_id),...Object.keys(v.payload.materials||{})].map(id=>[id,this.store.row('source_versions',id)])).values()];
    const profile=this.profiles().find(a=>a.id===v.payload.topic.account_id),status=approved?'已确认版':'待审版';
    const manifest={format:'content-workbench-handoff',version:1,topicId,accountId:v.payload.topic.account_id,accountName:profile?.name||'待归属',scriptVersionId:v.id,scriptVersionNumber:v.number,status,approval:approved,profile:profile?.profile||{},sources:sourceVersions.map(s=>({id:s.source_id,versionId:s.id,number:s.number,filename:s.filename,blobHash:s.blob_hash,metadata:parse(s.metadata)})),originals:[],omissions:[]};
    const checksum=hash(JSON.stringify(manifest)),existing=this.db.prepare('SELECT * FROM handoffs WHERE checksum=?').get(checksum);if(existing)return {...existing,payload:parse(existing.payload),existing:true};
    const files={'脚本与出处.md':strToU8(exportData.markdown),'脚本快照.json':strToU8(JSON.stringify(exportData.json,null,2))};let bytes=0;const hashes=new Set();
    for(const s of sourceVersions){if(!s.blob_hash||hashes.has(s.blob_hash))continue;hashes.add(s.blob_hash);const blob=this.db.prepare('SELECT * FROM blobs WHERE hash=?').get(s.blob_hash);
      if(!blob)throw new Error('引用原件记录缺失，未生成交付包。');
      const actual=await fileHash(blobPath(this.dir,s.blob_hash));if(actual.hash!==s.blob_hash||actual.size!==blob.size)throw new Error('引用原件字节校验失败，未生成交付包。');
      if(bytes+blob.size>100*1024*1024){manifest.omissions.push({blobHash:s.blob_hash,filename:s.filename,bytes:blob.size,reason:'超过交付包100MB原件预算；原件仍在工作台，按清单另行交付'});continue;}
      const name='引用原件/'+s.blob_hash.slice(0,12)+'-'+safeName(s.filename||'原件');files[name]=new Uint8Array(await fsp.readFile(blobPath(this.dir,s.blob_hash)));bytes+=blob.size;manifest.originals.push({path:name,sha256:s.blob_hash,bytes:blob.size});
    }
    files['交付清单.json']=strToU8(JSON.stringify(manifest,null,2));files['阅读说明.txt']=strToU8(`${status} · ${manifest.accountName}\n只包含此脚本快照、引用来源与预算内引用原件。\n未引用的材料不代表已经审阅；出处与使用权限分开核对。\n本文件是本机生成的交付包，没有发送给IP，没有自动发布。\n${manifest.omissions.length?'部分大原件需按交付清单另行交付。':'引用原件已按SHA-256核对。'}`);
    const filename=safeName(`${manifest.accountName}-${v.payload.draft.title}-v${v.number}-${status}.zip`),blob=await saveBuffer(this.store,this.dir,Buffer.from(zipSync(files,{level:1})),filename);
    return this.store.transaction(()=>{const concurrent=this.db.prepare('SELECT * FROM handoffs WHERE checksum=?').get(checksum);if(concurrent)return {...concurrent,payload:parse(concurrent.payload),existing:true};const id=uid();this.db.prepare('INSERT INTO handoffs VALUES(?,?,?,?,?,?,?,?,?)').run(id,topicId,v.id,approved?.id||null,blob.hash,filename,JSON.stringify(manifest),checksum,now());this.event(topicId,'生成交付包',{handoffId:id,versionId:v.id,status,originals:manifest.originals.length,omissions:manifest.omissions.length});return {...this.db.prepare('SELECT * FROM handoffs WHERE id=?').get(id),payload:manifest};});
  }
}
export function registerOperations(app,store,cfg){const ops=new Operations(store,cfg.dir);
  app.get('/api/operations',async()=>ops.summary());
  app.put('/api/operations/context',async req=>ops.context(req.body||{}));
  app.put('/api/operations/profiles/:id',async req=>ops.profile(req.params.id,req.body||{}));
  app.put('/api/operations/events/:id/opportunity',async req=>ops.opportunity(req.params.id,req.body||{}));
  app.post('/api/operations/events/:id/topic',async req=>ops.convert(req.params.id,req.body||{}));
  app.get('/api/operations/topics/:id',async req=>ops.topic(req.params.id));
  app.patch('/api/operations/topics/:id',async req=>ops.updateProduction(req.params.id,req.body||{}));
  app.post('/api/operations/topics/:id/reviews',async req=>ops.requestReview(req.params.id,req.body||{}));
  app.post('/api/operations/reviews/:id/decision',async req=>ops.decide(req.params.id,req.body||{}));
  app.post('/api/operations/topics/:id/handoffs',async req=>ops.handoff(req.params.id,req.body||{}));
}
