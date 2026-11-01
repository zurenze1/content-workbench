import React from 'react';
import './edit-plan.css';

export function EditPlan({url,compact=false,go}:{url?:string;compact?:boolean;go?:(view:string)=>void}){
  let href='';
  try{const parsed=new URL(url||'');if(['https:','http:'].includes(parsed.protocol))href=parsed.href;}catch{}
  return <section className={'edit-plan-section'+(compact?' compact':'')} aria-labelledby={compact?'edit-plan-home-title':'edit-plan-title'}>
    <div className="section-heading"><div>{compact?<h2 id="edit-plan-home-title">分镜执行台</h2>:<h1 id="edit-plan-title">分镜执行台</h1>}<p className="small muted">从脚本到镜头，让每一步剪辑都有据可依。</p></div>{compact&&go&&<button className="plain" onClick={()=>go('edit-plan')}>进入板块 →</button>}</div>
    <article className="edit-plan-card"><div className="edit-plan-copy"><span className="edit-plan-label">独立创作工具 · 在线打开</span><h2>阿祖剪辑执行台</h2><p>把口播、画面、花字、转场和声音放在同一张执行表里，随时对照分镜与素材继续剪辑。</p><div className="edit-plan-tags"><span>执行计划</span><span>脚本</span><span>分镜</span><span>素材</span></div>{href?<a className="button primary" href={href} target="_blank" rel="noopener noreferrer">打开分镜 ↗</a>:<p className="muted">尚未设置分镜工具链接。</p>}</div>
      <div className="edit-plan-preview" aria-hidden="true"><div className="edit-plan-preview-heading"><span>剪辑执行表</span><span>时间 · 画面 · 声音</span></div>{['口播与画面','花字与转场','音乐与音效'].map((label,i)=><div className="edit-plan-preview-row" key={label}><b>{String(i+1).padStart(2,'0')}</b><div><strong>{label}</strong><i/></div><span>↗</span></div>)}</div>
    </article>{!compact&&<p className="edit-plan-note">在新标签页打开原工具，可继续查看脚本、分镜和素材。内容与修改保存在原工具中。</p>}
  </section>;
}
