import React,{useEffect,useRef} from 'react';
export type Item=Record<string,any>;
export type Act=(fn:()=>Promise<any>,msg?:string)=>Promise<any>;
let csrf='';
export const setCsrf=(v:string)=>{csrf=v;};
export const csrfToken=()=>csrf;
export async function api(url:string,body?:unknown,method=body===undefined?'GET':'POST'){const r=await fetch('/api'+url,{method,headers:{'x-workbench-csrf':csrf,...(body!==undefined&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error||'保存失败');return data;}
let zone='Asia/Shanghai';
export const setZone=(z:string)=>{zone=z;};
export const stamp=(s:string,tz=zone)=>s?new Intl.DateTimeFormat('zh-CN',{timeZone:tz,dateStyle:'medium',timeStyle:'short'}).format(new Date(s)):'未知';
export const uid=()=>crypto.randomUUID();
export const sourceHref=(s:string)=>{try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)?u.href:undefined;}catch{return undefined;}};
export function Link({url,label}:{url:string;label?:string}){const href=sourceHref(url);return href?<a href={href} target="_blank" rel="noreferrer">{label||url} ↗</a>:<span className="muted">{url||'尚未提供出处'}</span>;}
export function Badge({children,tone}:{children:React.ReactNode;tone?:string}){const s=String(children);return <span className={'badge '+(tone||(['成功','人工已核验','可引用','已送达','引用已校验','已完成','已发布','按时生成','已启用'].includes(s)?'good':['失败','不可使用','错过','待查','不建议跟进','已拒绝'].includes(s)?'bad':''))}>{children}</span>;}
export function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{React.Children.map(children,child=>React.isValidElement(child)&&["input","select","textarea"].includes(String(child.type))?React.cloneElement(child as React.ReactElement<any>,{"aria-label":(child.props as Item)["aria-label"]||label}):child)}</label>;}
export function Select({label,value,values,onChange}:{label:string;value:string;values:string[];onChange:(v:string)=>void}){return <Field label={label}><select value={value} onChange={e=>onChange(e.target.value)}>{values.map(v=><option key={v}>{v}</option>)}</select></Field>;}
export function Dialog({title,children,onClose,wide}:{title:string;children:React.ReactNode;onClose:()=>void;wide?:boolean}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);return <dialog ref={ref} className={wide?'wide':''} onCancel={e=>{e.preventDefault();onClose();}}><div className="dialog-top"><h2>{title}</h2><button className="plain" onClick={onClose} aria-label="关闭窗口">×</button></div>{children}</dialog>;}
export function Heading({eyebrow,title,lead,children}:{eyebrow:string;title:string;lead:string;children?:React.ReactNode}){return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{lead}</p></div>{children&&<div className="heading-actions">{children}</div>}</div>;}
export function Empty({title,children}:{title:string;children?:React.ReactNode}){return <div className="empty paper"><h2>{title}</h2>{children}</div>;}
export const fmt=(v:number|null|undefined,unit='')=>v==null?'缺失':(Math.round(v*100)/100).toLocaleString('zh-CN')+(unit==='percent'?'%':unit==='seconds'?'秒':'');
// 把UTC时刻显示为某时区的 datetime-local 字符串
export function localValue(iso:string,tz:string){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(iso)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
