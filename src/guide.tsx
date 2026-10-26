import React,{useState} from 'react';
import {api,Badge,stamp,type Item} from './ui';
import './workflow.css';

const STEPS = [
  {title:'选一个真正想做的题',page:'board',action:'进入项目创作',text:'从“发现”判断一条线索，或新建项目。先选自己的账号或实际服务IP，写清要讲给谁、回答什么问题。历史待归属项目仍在账号与IP中。'},
  {title:'把原件与出处放在一起',page:'assets',action:'搜索或采集素材',text:'用右上角“采集资料”粘贴原文、保存链接或上传文件。已有资料和归集原件可统一搜索；关联项目后，在资料详情摘录具体证据。仅保存链接不代表已取得视频原片或使用权。'},
  {title:'先转文字，再核对',page:'transcripts',action:'打开音视频逐字稿',text:'上传音视频可在本机转写，也可导入已有字幕。结果保留口语，先对照原声检查姓名、数字和断句，再用于脚本。平台链接受登录、时效和下载条件影响，失败时改用自己的本地原片。'},
  {title:'逐句写稿，逐句配画面',page:'board',action:'选择项目写分镜',text:'项目→脚本与镜头→逐句分镜表。左侧时间未知就留空；中间写旁白、画面需求与剪辑说明；右侧上传、粘贴或选素材，并标记主选/备选。切到“提案演示”逐句比较画面。'},
  {title:'保存采用版本，再审稿交付',page:'board',action:'打开项目',text:'编辑会自动保存，看到“已保存到本地服务”后再离开。保存版本快照可固定稿件与素材。审稿交付针对具体版本记录真实意见、生成带出处的交付包。提案只展示已有内容，不会自动生成画面。'},
  {title:'人工发布，带真实数据回来',page:'review',action:'打开发布复盘',text:'项目→发布登记保存真实作品链接和采用版本；历史版本未知可明确标记待确认。抖音后台Excel需本人导出，预览并确认作品、单位和采集时间再入库。排期提醒不会代替平台发布。'}
];

export function UserGuide({boot,go}:{boot:Item;go:(id:string)=>void}){
  const [checks,setChecks]=useState<Item[]>([]),[running,setRunning]=useState(false),[checkedAt,setCheckedAt]=useState('');
  async function check(){
    setRunning(true);setChecks([]);setCheckedAt('');
    const specs:[string,string,(v:any)=>string][]=[
      ['本地资料服务','/bootstrap',v=>`${v.counts.sources}份资料 · ${v.counts.topics}个项目`],
      ['项目与流程','/operations',v=>`${v.topics.length}个项目，进度可读取`],
      ['采集任务','/jobs',v=>`${v.length}条服务端任务记录`],
      ['作品复盘','/analytics/publications',v=>`${v.length}条已登记发布记录`],
      ['原件检索','/workspace/archive?limit=1',v=>`${v.total}份当前可见原件`],
      ['Codex本机登录','/studio/status',v=>v.error?`登录${v.loggedIn?'有效':'未确认'}；模型列表未取得：${v.error}`:v.loggedIn?`本机已登录 · ${v.models.length}个可用模型；未生成内容`:'本机尚未登录，请到设置检查']
    ];
    await Promise.all(specs.map(async([name,url,describe])=>{try{const value=await api(url);setChecks(old=>[...old,{name,ok:true,text:describe(value)}]);}catch(e:any){setChecks(old=>[...old,{name,ok:false,text:e.message}]);}}));
    setCheckedAt(new Date().toISOString());setRunning(false);
  }
  return <div className="guide-page"><header className="guide-intro"><p className="eyebrow">WORKBENCH / FIELD GUIDE</p><h1>先做完一条，再做下一条。</h1><p>祖老大，这份说明按真实操作顺序写。工作台负责整理、写作、审阅和复盘；剪辑与平台发布仍在你实际使用的软件中完成。</p><div className="actions"><button className="primary" onClick={()=>go('board')}>继续我的项目 →</button><button onClick={()=>go('settings')}>设置与备份</button><Badge>当前版本 {boot.version}</Badge></div></header>
    <div className="guide-steps">{STEPS.map((s,i)=><section className="paper" key={s.title}><span className="guide-step">{String(i+1).padStart(2,'0')}</span><h2>{s.title}</h2><p>{s.text}</p><button onClick={()=>go(s.page)}>{s.action} →</button></section>)}</div>
    <section className="paper guide-checks"><div className="section-heading"><div><h2>检查这台电脑上的入口</h2><p className="small muted">只读取状态和记录，不发送模型消息、不抓取外部平台、不写入业务数据。</p></div><button disabled={running} onClick={check}>{running?`检查中 · ${checks.length}/6`:'检查本机状态'}</button></div>{checkedAt&&<p className="small muted">检查时间：{stamp(checkedAt)}。接口可读不等于所有业务操作已验证。</p>}<ul>{checks.map(c=><li key={c.name}><Badge>{c.ok?'已读取':'需处理'}</Badge><b>{c.name}</b><span>{c.text}</span></li>)}</ul></section>
    <section className="paper"><h2>哪些能直接用，哪些有条件</h2><div className="capability-list"><p><Badge>本机操作</Badge> 项目、资料保存、分镜、提案、版本、审稿记录、手动数据导入与备份。</p><p><Badge>{boot.services.transcription.state}</Badge> 转写依赖本机转写环境；文字结果需对照原声校对。</p><p><Badge>{boot.services.model.state}</Badge> 创作助手与AI分析需要设置中的模型连接和账号额度；启用开关不等于调用成功。回复不会自动改写正文。</p><p><Badge>需配置</Badge> RSS来源与本机运行时的抓取频率。Codex早报是既有外部任务入库，与RSS分开管理。</p><p><Badge>本人完成</Badge> 登录/验证码、取得素材使用权、实际剪辑、平台发布和后台原表导出。工作台没有承诺自动登录、自动发布或预测爆款。</p></div></section>
    <details className="paper"><summary>卡住时，按这里排查</summary><ul><li>链接读不到：到采集任务看原因；保留出处，改传自己有权使用的本地原文件。</li><li>保存冲突：保留当前文字，刷新核对其他窗口修改；不要反复覆盖。</li><li>助手无回复：检查设置中的登录、模型与额度，再查看任务错误；手动写作不受影响。</li><li>找不到旧项目：账号与IP→历史项目待归属，或切换到“全部IP与待归属项目”。</li><li>导入数据不对：先核作品、单位、时间和统计窗口，确认前不入库。</li><li>误移素材：在设置→回收站恢复。完整备份含数据库与原件；恢复先验证到独立目录。</li></ul><div className="actions"><button onClick={()=>go('tasks')}>查看任务</button><button onClick={()=>go('recycle')}>回收站</button><button onClick={()=>go('ips')}>账号与IP</button></div></details>
  </div>;
}
