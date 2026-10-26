export type MaterialRole='主选'|'备选'|'参考';
export type MaterialRef={sourceId:string;versionId:string;role?:MaterialRole};
export type StorySegment={id:string;heading:string;narration:string;shot:string;subtitle:string;evidenceIds:string[];startSec?:number|null;endSec?:number|null;materials?:MaterialRef[];editNote?:string};
export function assignMaterialRole(materials:MaterialRef[],versionId:string,role:MaterialRole):MaterialRef[]{
  return materials.map(r=>r.versionId===versionId?{...r,role}:role==='主选'&&r.role==='主选'?{...r,role:'备选'}:r);
}

export function formatTime(value:number|null|undefined){
  if(value==null)return '';
  const n=Math.round(value*1000),seconds=(n%60000)/1000;
  return `${Math.floor(n/60000).toString().padStart(2,'0')}:${seconds<10?'0':''}${seconds.toFixed(3).replace(/\.?0+$/,'')}`;
}
export function parseTime(value:string):number|null{
  const s=value.trim();if(!s)return null;
  const m=/^(\d+):([0-5]?\d(?:\.\d{1,3})?)$/.exec(s),cn=/^(?:(\d+)分)?(\d+(?:\.\d{1,3})?)秒$/.exec(s);
  const n=m?Number(m[1])*60+Number(m[2]):cn?Number(cn[1]||0)*60+Number(cn[2]):/^\d+(?:\.\d{1,3})?$/.test(s)?Number(s):NaN;
  if(!Number.isFinite(n)||n<0||n>86400)throw new Error('请填分:秒（01:23.5）、1分23秒，或秒数');
  return Math.round(n*1000)/1000;
}
// Keep every original character, including punctuation, whitespace and closing quotes.
export function sentenceParts(value:string){
  const parts=value.match(/[\s\S]*?(?:[。！？!?]+[」』”’"）)]*|\n+|$)/g)?.filter(Boolean)||[''];
  return parts.reduce<string[]>((rows,p)=>{if(!p.trim()&&rows.length)rows[rows.length-1]+=p;else rows.push(p);return rows;},[]);
}
export function splitForStoryboard<T extends {segments:StorySegment[];budget?:{sections:{segmentIds:string[]}[]}}>(draft:T,makeId:()=>string):T{
  const next=structuredClone(draft),mapping=new Map<string,string[]>();
  next.segments=draft.segments.flatMap(s=>{
    const parts=sentenceParts(s.narration);if(parts.length<2)return [structuredClone(s)];
    if((s.startSec!=null||s.endSec!=null)||(s.materials?.length||0)>0)throw new Error('已有时间或素材的行请手动拆分，以免错配');
    const rows=parts.map((n,i)=>({...structuredClone(s),id:i?makeId():s.id,narration:n}));
    mapping.set(s.id,rows.map(r=>r.id));return rows;
  });
  if(next.segments.length>500)throw new Error('分镜最多500行，请分成多个脚本');
  if(next.budget)next.budget.sections.forEach(s=>{s.segmentIds=s.segmentIds.flatMap(id=>mapping.get(id)||[id]);});
  return next;
}
