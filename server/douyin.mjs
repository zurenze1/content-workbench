// Export workflow/column aliases adapted from TradingAi666/TzFilm-Douyin-Tool
// a0c12c3 (MIT). See docs/vendor/TzFilm-LICENSE.txt. No upstream main() is run.
import fs from 'node:fs/promises';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {unzipSync,strFromU8} from 'fflate';
import {Analytics,cell,SCALES,PAID} from './analytics.mjs';
import {saveBuffer,blobPath,safeName} from './files.mjs';
import {choice} from './store.mjs';

export const DOUYIN_SOURCE={project:'TzFilm-Douyin-Tool',repository:'https://github.com/TradingAi666/TzFilm-Douyin-Tool',revision:'a0c12c3fc47f48797b306a2ed144ec9c0f30e8e6',license:'MIT',mode:'manual-excel',exportUrl:'https://creator.douyin.com/creator-micro/content/manage'};
export const douyinStatus=()=>({state:'已接入：抖音后台Excel导入',enabled:true,mode:'manual-excel',apiConnected:false,automaticCollection:false});
const MAX_FILE=12*1024*1024,MAX_ROWS=5000;
const normal=s=>String(s).replace(/[\s（）()·_\-]/g,'').toLowerCase();
const ALIASES={title:['作品名称','作品标题','视频标题','标题'],published:['发布时间','发布日期'],status:['审核状态','作品状态'],views:['播放量','播放次数'],completion:['完播率','整体完播率'],retention5s:['5s完播率','5秒完播率','5s留存率'],ctr:['封面点击率'],bounce2s:['2s跳出率','2秒跳出率'],avg_watch_sec:['平均播放时长','平均观看时长'],likes:['点赞量','点赞数'],shares:['分享量','分享数'],comments:['评论量','评论数'],favorites:['收藏量','收藏数'],profile_visits:['主页访问量']};
function xml(bytes){const value=strFromU8(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(value))throw new Error('不支持包含外部实体的表格');return new JSDOM(value,{contentType:'text/xml'});}
function nodes(doc,tag){return [...doc.getElementsByTagName(tag)];}
function readXML(bytes,fn){const dom=xml(bytes);try{return fn(dom.window.document);}finally{dom.window.close();}}
function indexOf(ref){let n=0;for(const c of ref.match(/^[A-Z]+/)?.[0]||'')n=n*26+c.charCodeAt(0)-64;if(n<1||n>128)throw new Error('表格列数超过128列');return n-1;}

export function parseDouyinExport(buffer){
  if(!buffer.length||buffer.length>MAX_FILE)throw new Error('请选择12MB以内的抖音后台xlsx文件');
  if(buffer[0]!==80||buffer[1]!==75)throw new Error('文件不是有效xlsx；若导出的是登录错误，请重新登录后台');
  let total=0,files;
  try{files=unzipSync(buffer,{filter:f=>{if(!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(f.name))return false;total+=f.originalSize;if(f.originalSize>8*1024*1024||total>24*1024*1024)throw new Error('表格展开内容超过24MB');return true;}});}catch(e){throw new Error('xlsx解压失败：'+e.message);}
  const strings=files['xl/sharedStrings.xml']?readXML(files['xl/sharedStrings.xml'],d=>nodes(d,'si').map(si=>nodes(si,'t').map(t=>t.textContent).join(''))):[];
  const styles=files['xl/styles.xml']?readXML(files['xl/styles.xml'],d=>{const formats=Object.fromEntries(nodes(d,'numFmt').map(n=>[n.getAttribute('numFmtId'),n.getAttribute('formatCode')||'']));return nodes(d.getElementsByTagName('cellXfs')[0]||d,'xf').map(n=>{const id=Number(n.getAttribute('numFmtId')),fmt=(formats[id]||'').replace(/"[^"]*"|\\./g,'');return {percent:[9,10].includes(id)||fmt.includes('%'),date:(id>=14&&id<=22)||(/[yd]/i.test(fmt)&&/[m]/i.test(fmt))};});}):[];
  let sheetPath=Object.keys(files).filter(k=>k.startsWith('xl/worksheets/')).sort()[0],sheetName='工作表',date1904=false;
  if(files['xl/workbook.xml'])readXML(files['xl/workbook.xml'],d=>{date1904=['1','true'].includes(d.getElementsByTagName('workbookPr')[0]?.getAttribute('date1904'));const sheets=nodes(d,'sheet'),active=Number(d.getElementsByTagName('workbookView')[0]?.getAttribute('activeTab')||0),sheet=sheets[active]||sheets[0];sheetName=sheet?.getAttribute('name')||sheetName;const id=sheet?.getAttribute('r:id');if(id&&files['xl/_rels/workbook.xml.rels'])readXML(files['xl/_rels/workbook.xml.rels'],rels=>{const rel=nodes(rels,'Relationship').find(n=>n.getAttribute('Id')===id);if(rel?.getAttribute('TargetMode')==='External')throw new Error('工作表不能引用外部文件');const target=rel?.getAttribute('Target');if(target){const name=target.startsWith('/')?target.slice(1):path.posix.normalize(path.posix.join('xl',target));if(!/^xl\/worksheets\/[^/]+\.xml$/.test(name))throw new Error('工作表路径无效');sheetPath=name;}});});
  if(!sheetPath||!files[sheetPath])throw new Error('没有找到当前工作表');
  const rows=readXML(files[sheetPath],d=>{const rs=nodes(d,'row');if(rs.length>MAX_ROWS+20)throw new Error('单次最多读取5000行，请分批导出');return rs.map((row,i)=>{const cells=[];for(const c of nodes(row,'c')){const col=indexOf(c.getAttribute('r')||''),raw=c.getElementsByTagName('v')[0]?.textContent||'',type=c.getAttribute('t'),style=styles[Number(c.getAttribute('s')||0)]||{};let value=raw;if(type==='s'){const at=Number(raw);if(!Number.isSafeInteger(at)||at<0||at>=strings.length)throw new Error('表格共享文本索引无效');value=strings[at];}else if(type==='inlineStr')value=nodes(c,'t').map(t=>t.textContent).join('');else if(type==='b')value=raw==='1'?'TRUE':'FALSE';else if(style.date&&raw!==''&&Number.isFinite(Number(raw))){const epoch=Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30),date=new Date(epoch+Number(raw)*86400000);if(Number.isFinite(date.getTime()))value=date.toISOString().replace('T',' ').replace(/\.\d+Z$/,'');}cells[col]={value,percent:!!style.percent,formula:!!c.getElementsByTagName('f').length};}return {line:Number(row.getAttribute('r'))||i+1,cells};});});
  const headAt=rows.slice(0,20).findIndex(r=>r.cells.some(c=>c&&ALIASES.title.some(x=>normal(x)===normal(c.value)))&&r.cells.some(c=>c&&Object.values(ALIASES).slice(3).flat().some(x=>normal(x)===normal(c.value))));
  if(headAt<0)throw new Error('没有找到作品名称和播放等指标表头；请选择抖音创作者后台导出的作品列表');
  const headers=Array.from({length:rows[headAt].cells.length},(_,i)=>(rows[headAt].cells[i]?.value||'').trim());
  if(headers.some(h=>!h)||new Set(headers).size!==headers.length)throw new Error('表头存在空白或重名，请先检查导出文件');
  const rowsOut=rows.slice(headAt+1).filter(r=>r.cells.some(c=>c?.value.trim())).map(r=>({line:r.line,raw:Object.fromEntries(headers.map((h,i)=>[h,r.cells[i]?.value||''])),percentColumns:headers.filter((h,i)=>r.cells[i]?.percent),formulaColumns:headers.filter((h,i)=>r.cells[i]?.formula)}));
  if(!rowsOut.length)throw new Error('作品列表没有数据');
  if(rowsOut.length>MAX_ROWS)throw new Error('单次最多导入5000行');
  return {headers,rows:rowsOut,sheet:sheetName};
}

function metadata(parsed){return Object.fromEntries(['title','published','status'].map(k=>[k,parsed.headers.find(h=>ALIASES[k].some(a=>normal(a)===normal(h)))]));}
export function previewDouyin(buffer,analytics){const parsed=parseDouyinExport(buffer),columns=analytics.suggest(parsed.headers),meta=metadata(parsed);for(const h of parsed.headers){const explicit=Object.entries(ALIASES).find(([k,aliases])=>!['title','published','status'].includes(k)&&aliases.some(a=>normal(a)===normal(h)))?.[0];if(explicit)columns[h]={metric:explicit,scale:analytics.def(explicit).unit==='percent'?'':analytics.def(explicit).unit==='seconds'?'秒':'数值'};if(Object.values(meta).includes(h)||columns[h].special)columns[h]={scale:'忽略此列'};if(columns[h].metric&&analytics.def(columns[h].metric).unit==='percent'){const present=parsed.rows.filter(r=>r.raw[h].trim()&&!/^(?:-|—|--)$/u.test(r.raw[h].trim()));if(present.length&&present.every(r=>r.percentColumns.includes(h)))columns[h].scale='小数比例（0.35表示35%）';else if(present.length&&present.every(r=>r.raw[h].trim().endsWith('%')))columns[h].scale='带百分号（35%）';}if(normal(h)==='粉丝增量')columns[h]={scale:'忽略此列',note:'粉丝增量的口径需确认：新增关注和净增粉不能混用'};}
  const pubs=analytics.publications().filter(p=>analytics.platformOf(p.id)==='抖音');
  return {...parsed,columns,metadata:meta,total:parsed.rows.length,rows:parsed.rows.map(r=>({...r,title:r.raw[meta.title]||'',published:r.raw[meta.published]||'',status:r.raw[meta.status]||'',suggestedPublicationIds:pubs.filter(p=>normal(p.topic_title)===normal(r.raw[meta.title]||'')).map(p=>p.id)})),publications:pubs,source:DOUYIN_SOURCE};
}

export function commitDouyin(parsed,analytics,body,blob){
  if(body.confirmed!==true)throw new Error('请确认账号、作品、单位和采集时间后再保存');
  const account=analytics.store.row('accounts',body.accountId);
  if(!['自有','获授权管理'].includes(account.role))throw new Error('只能导入自有或获授权管理账号的后台数据');
  const capture=new Date(body.capturedAt||'');if(!Number.isFinite(capture.getTime()))throw new Error('请填写真实采集时间');
  const selections=body.selections;if(!Array.isArray(selections)||!selections.length||selections.length>MAX_ROWS)throw new Error('请选择要保存的数据行');
  const columns=body.columns||{},defs=analytics.defs();
  for(const h of Object.keys(columns))if(!parsed.headers.includes(h))throw new Error('字段映射引用了不存在的列');
  if(parsed.headers.some(h=>!columns[h]))throw new Error('请逐列确认指标或选择忽略');
  for(const h of parsed.headers){const c=columns[h];if(c.special)throw new Error('作品与时间通过单独确认项填写');if(c.metric){const def=defs.find(d=>d.key===c.metric);if(!def||def.derived||!SCALES.includes(c.scale)||c.scale==='忽略此列')throw new Error('请确认「'+h+'」的指标和单位');}}
  if(!Object.values(columns).some(c=>c.metric))throw new Error('至少选择一个真实指标');
  const seen=new Set(),rows=[],paid=choice(body.paid,PAID,'未知');
  for(const selected of selections){const row=parsed.rows.find(r=>r.line===selected.line);if(!row||seen.has(row.line))throw new Error('选择了不存在或重复的数据行');seen.add(row.line);const pub=analytics.store.row('publications',selected.publicationId);if(analytics.accountOf(pub.id)!==account.id||analytics.platformOf(pub.id)!=='抖音')throw new Error('第'+row.line+'行作品不属于所选抖音账号');const age=(capture.getTime()-new Date(pub.published_at).getTime())/3600000;if(!(age>0))throw new Error('第'+row.line+'行采集时间必须晚于作品发布时间');for(const [h,c] of Object.entries(columns))if(c.metric){try{cell(row.raw[h],c.scale,analytics.def(c.metric));}catch(e){throw new Error('第'+row.line+'行 '+h+'：'+e.message);}}rows.push({...row.raw,'__作品确认__':pub.id,'__观察小时__':Math.round(age*1000000)/1000000});}
  if(parsed.headers.some(h=>['__作品确认__','__平台作品ID__','__观察小时__'].includes(h)))throw new Error('表头与内部确认字段重名');
  for(const row of rows){const pub=analytics.store.row('publications',row['__作品确认__']);row['__作品确认__']=pub.url;row['__平台作品ID__']=/douyin\.com\/video\/(\d+)/.exec(pub.url)?.[1]||'';}
  const content=JSON.stringify(rows),mapping={columns:{...columns,'__作品确认__':{special:'作品链接'},'__平台作品ID__':{special:'作品ID'},'__观察小时__':{special:'统计窗口（小时）'}},capturedAt:capture.toISOString(),paid,cumulative:true,windowLabel:'累计至采集时间',accountId:account.id,source:DOUYIN_SOURCE,sheet:parsed.sheet,confirmed:true};
  const result=analytics.commit({content,format:'json',filename:blob.name,mapping},blob);
  return {...result,selected:rows.length,unselected:parsed.rows.length-rows.length,original:{hash:blob.hash,filename:blob.name},mode:'manual-excel'};
}

export function registerDouyin(app,store,cfg){const ana=new Analytics(store);
  app.get('/api/douyin/status',async()=>({...douyinStatus(),source:DOUYIN_SOURCE}));
  app.post('/api/douyin/preview',async req=>{const part=await req.file({limits:{fileSize:MAX_FILE}});if(!part)throw new Error('请选择作品列表xlsx');const name=safeName(part.filename||'作品列表.xlsx');if(!/\.xlsx$/i.test(name))throw new Error('仅支持抖音后台导出的xlsx文件');const data=await part.toBuffer();if(part.file.truncated)throw new Error('文件超过12MB');const preview=previewDouyin(data,ana),blob=await saveBuffer(store,cfg.dir,data,name);return {...preview,original:{hash:blob.hash,filename:name,size:blob.size}};});
  app.post('/api/douyin/import',{bodyLimit:2*1024*1024},async req=>{const b=req.body||{},row=store.db.prepare('SELECT * FROM blobs WHERE hash=?').get(b.blobHash);if(!row||row.size>MAX_FILE)throw new Error('没有找到已上传的原始Excel，请重新预览');const buffer=await fs.readFile(blobPath(cfg.dir,row.hash));return commitDouyin(parseDouyinExport(buffer),ana,b,{hash:row.hash,name:safeName(b.filename||'作品列表.xlsx')});});
}
