import React,{useEffect,useRef,useState} from 'react';
import {api,Badge,Link,type Item} from './ui';
import {formatTime,type StorySegment,type MaterialRef} from './storyboard-model';
import './proposal.css';

function MaterialPreview({refItem,material}:{refItem:MaterialRef;material?:Item}){
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[refItem.versionId]);
  if(!material)return <div className="proposal-missing"><b>素材暂未读取</b><p>回到编辑表核对来源；不会用占位图片代替。</p></div>;
  const source=material.source||{},meta=material.metadata||{},title=meta.title||source.title||material.filename||'未命名素材',src=material.blob_hash?'/api/blobs/'+material.blob_hash:undefined,kind=source.kind||meta.kind;
  return <figure className="proposal-material">{src&&!failed?(kind==='图片'?<img src={src} alt={title} onError={()=>setFailed(true)}/>:kind==='视频'?<video controls preload="metadata" src={src} aria-label={title} onError={()=>setFailed(true)}/>:kind==='音频'?<audio controls src={src} aria-label={title} onError={()=>setFailed(true)}/>:<div className="proposal-file">原件已保存 · {kind||'文件'}<p>请下载原件查看内容。</p></div>):<div className="proposal-file">{failed?'原件预览失败，请核对文件':'仅有出处，尚无本机原件'}</div>}<figcaption><b>{title}</b><p><Badge>{refItem.role||'用途未指定'}</Badge> 固定来源 v{material.number} · {meta.rights||source.rights||'权限待核实'}</p><small>{meta.verification||source.verification||'未核验'}</small><div className="actions">{(meta.url||source.url)&&<Link url={meta.url||source.url} label="原始出处"/>}{src&&<a className="button" href={src+'?download=1&name='+encodeURIComponent(material.filename||title)}>下载原件 ↓</a>}</div></figcaption></figure>;
}

export function StoryProposal({draft,fixedMaterials}:{draft:{title:string;segments:StorySegment[]};fixedMaterials?:Record<string,Item>}){
  const [index,setIndex]=useState(0),[mode,setMode]=useState('shot'),[presenting,setPresenting]=useState(false),[cache,setCache]=useState<Record<string,Item>>({}),[error,setError]=useState(''),[retry,setRetry]=useState(0),[loading,setLoading]=useState(false);
  const root=useRef<HTMLDivElement>(null),launch=useRef<HTMLButtonElement>(null);
  const refs=draft.segments.flatMap(s=>s.materials||[]),key=refs.map(r=>r.sourceId+':'+r.versionId).join(',');
  useEffect(()=>{if(fixedMaterials)return;let live=true;const ids=[...new Set(refs.map(r=>r.sourceId))];setError('');setLoading(!!ids.length);Promise.all(ids.map(async id=>{try{return await api('/sources/'+id);}catch(e:any){if(live)setError('部分素材读取失败：'+e.message);return null;}})).then(items=>{if(!live)return;const next:Record<string,Item>={};for(const source of items)if(source)for(const v of source.versions)next[v.id]={...v,source};setCache(next);setLoading(false);});return()=>{live=false;};},[key,retry,fixedMaterials]);
  useEffect(()=>setIndex(i=>Math.min(i,Math.max(0,draft.segments.length-1))),[draft.segments.length]);
  useEffect(()=>{if(!presenting)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';root.current?.focus();return()=>{document.body.style.overflow=previous;launch.current?.focus();};},[presenting]);
  function close(){setPresenting(false);}
  const materials=fixedMaterials||cache,s=draft.segments[index],primary=s?.materials?.find(r=>r.role==='主选'),alternates=s?.materials?.filter(r=>r.role==='备选')||[],others=s?.materials?.filter(r=>!r.role||r.role==='参考')||[];
  useEffect(()=>{
    if(!presenting)return;
    const keydown=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();setPresenting(false);return;}
      const target=e.target instanceof HTMLElement?e.target:null;
      if(target?.closest('input,textarea,select,video,audio'))return;
      if(e.key==='ArrowRight'){e.preventDefault();setIndex(i=>Math.min(draft.segments.length-1,i+1));}
      if(e.key==='ArrowLeft'){e.preventDefault();setIndex(i=>Math.max(0,i-1));}
      if(e.key==='Tab'){
        const items=root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select,video[controls],audio[controls]');
        if(items?.length){const first=items[0],last=items[items.length-1];if(!root.current?.contains(document.activeElement)){e.preventDefault();first.focus();}else if(e.shiftKey&&(document.activeElement===first||document.activeElement===root.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
      }
    };
    window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown);
  },[presenting,draft.segments.length]);
  return <div ref={root} className={'proposal '+(presenting?'proposal-full':'')} tabIndex={-1} role={presenting?'dialog':undefined} aria-modal={presenting?true:undefined} aria-label="分镜提案演示">
    <header className="proposal-header"><div><p className="eyebrow">STORY / SHOT PROPOSAL</p><h3>{draft.title}</h3><p className="small muted">{fixedMaterials?'固定历史快照':'当前草稿'} · {draft.segments.length}句 · {refs.length}份素材关联 · 时间未知保持待定</p></div><div className="actions"><button className={mode==='shot'?'primary':''} onClick={()=>setMode('shot')}>逐句画面</button><button className={mode==='copy'?'primary':''} onClick={()=>setMode('copy')}>文案总览</button>{presenting?<button onClick={close}>退出演示 Esc</button>:<button ref={launch} onClick={()=>setPresenting(true)}>全屏演示</button>}</div></header>
    {error&&<p role="alert" className="notice error">{error} <button onClick={()=>setRetry(r=>r+1)}>重新读取</button></p>}{loading&&<p role="status">正在读取已保存的素材版本…</p>}
    {!s?<p>当前没有分镜。回到编辑表添加一句文案。</p>:<>{mode==='copy'?<div className="proposal-copy-board">{draft.segments.map((row,i)=><button key={row.id} onClick={()=>{setIndex(i);setMode('shot');}}><small>{String(i+1).padStart(2,'0')} · {row.heading||'正文'} · {row.startSec==null?'待定':formatTime(row.startSec)} → {row.endSec==null?'待定':formatTime(row.endSec)}</small><p>{row.narration||'文案待补'}</p><span>{row.shot||'画面需求待补'} →</span></button>)}</div>:<><nav className="proposal-paging" aria-label="提案逐句导航"><button disabled={!index} onClick={()=>setIndex(i=>i-1)}>← 上一句</button><select aria-label="选择提案分镜" value={index} onChange={e=>setIndex(Number(e.target.value))}>{draft.segments.map((row,i)=><option key={row.id} value={i}>第{i+1}句 · {row.heading||row.narration.slice(0,24)||'文案待补'}</option>)}</select><span>{index+1} / {draft.segments.length}</span><button disabled={index===draft.segments.length-1} onClick={()=>setIndex(i=>i+1)}>下一句 →</button></nav>
    <div className="proposal-stage" key={s.id}><section className="proposal-copy"><p className="eyebrow">{String(index+1).padStart(2,'0')} / {s.heading||'正文'}</p><p className="proposal-time">{s.startSec==null?'时间待定':formatTime(s.startSec)} → {s.endSec==null?'待定':formatTime(s.endSec)}</p><p className="proposal-narration">{s.narration||'文案待补'}</p><h4>需要的画面</h4><p>{s.shot||'尚未填写'}</p>{s.editNote&&<><h4>剪辑说明</h4><p>{s.editNote}</p></>}{s.subtitle&&<><h4>字幕 / 动效</h4><p>{s.subtitle}</p></>}<small>本句关联 {s.evidenceIds.length} 条具体证据；回到段落编辑可逐条核对。</small></section>
    <section className="proposal-visuals"><div className="proposal-choices"><section><h4>A · 主选画面</h4>{primary?<MaterialPreview refItem={primary} material={materials[primary.versionId]}/>:<div className="proposal-missing">主选待定。回到逐句分镜表，为一份素材标记“主选”。</div>}</section><section><h4>B · 备选画面</h4>{alternates.length?<div className="proposal-alternates">{alternates.map(r=><MaterialPreview key={r.versionId} refItem={r} material={materials[r.versionId]}/>)}</div>:<p className="small muted">尚未添加备选画面。</p>}</section></div>{others.length>0&&<><h4>参考与未指定用途 · {others.length}</h4><div className="proposal-alternates">{others.map(r=><MaterialPreview key={r.versionId} refItem={r} material={materials[r.versionId]}/>)}</div></>}</section></div></>}
    <p className="proposal-footnote">素材与出处来自保存记录；公开可读不代表可直接使用。此页不生成新文案或画面。{presenting?'可用左右方向键切句，Esc退出。':''}</p></>}
  </div>;
}
