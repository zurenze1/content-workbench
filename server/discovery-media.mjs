import {JSDOM} from 'jsdom';
import {sourceUrl,fetchPublic} from './security.mjs';
import {saveBuffer} from './files.mjs';
import {hash,now} from './store.mjs';
import {shanghaiDay} from './hot.mjs';

export function newsChannel(n){
  if(['people','culture','ai','other'].includes(n.channel))return n.channel;
  const c=n.category||'';
  if(/^AI(?:[\s/·]|$)|人工智能|大模型/i.test(c))return 'ai';
  if(/人物/.test(c))return 'people';
  if(/文化|文学|阅读|历史|艺术|非遗/.test(c))return 'culture';
  return 'other';
}
export function dateWindow(q={}){
  const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&shanghaiDay(new Date(s+'T12:00:00+08:00'))===s;
  const from=String(q.from||q.day||''),to=String(q.to||q.day||'');
  if((from&&!valid(from))||(to&&!valid(to))||from&&to&&from>to)throw new Error('日期范围无效');
  return {from:from?new Date(from+'T00:00:00+08:00').toISOString():'',to:to?new Date(new Date(to+'T00:00:00+08:00').getTime()+86400000).toISOString():''};
}
export function imageCandidate(html,base){
  const dom=new JSDOM(html);try{
    for(const selector of ['meta[property="og:image"]','meta[name="twitter:image"]','meta[property="og:image:url"]']){
      const value=dom.window.document.querySelector(selector)?.getAttribute('content');
      if(value&&!/logo|icon|qrcode/i.test(value))try{return sourceUrl(new URL(value,base).href);}catch{}
    }
    const doc=dom.window.document,specific='.left_zw,.trs_editor_view,.TRS_Editor,.rm_txt_con,[itemprop="articleBody"],.article-body,.articleContent,#p-detail';
    const roots=[...doc.querySelectorAll(specific)];
    const images=roots.length?roots.flatMap(root=>[...root.querySelectorAll('img')]):[...doc.querySelectorAll('article img,main img,.article img,.content img,#content img,.main-aticle img,.article-main img,.con img')];
    for(const img of images){
      if(img.closest('nav,header,footer,aside,[class*="qrcode"],[class*="download"],[class*="Download"],[class*="recommend"],.intermoren_box,[class*="share"]'))continue;
      for(const raw of [img.getAttribute('data-src'),img.getAttribute('src')]){
        if(!raw||/logo|icon|avatar|qrcode|spinner|spacer/i.test(raw))continue;
        try{return sourceUrl(new URL(raw,base).href);}catch{}
      }
    }
    return '';
  }finally{dom.window.close();}
}
function imageName(buffer){
  if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'source-image.png';
  if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'source-image.jpg';
  if(buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP')return 'source-image.webp';
  if(/^GIF8[79]a/.test(buffer.subarray(0,6).toString()))return 'source-image.gif';
  throw new Error('来源没有返回可安全预览的PNG/JPEG/WebP/GIF图片');
}
export function mediaFor(store,url){return (store.get('discovery.media')||{})[hash(url)]||null;}
export async function collectNewsImage(store,dir,input,{signal,fetcher=fetchPublic}={}){
  const url=sourceUrl(input.url),old=mediaFor(store,url);
  if(old?.hash&&!input.force)return old;
  const entry={url,imageUrl:'',hash:null,observedAt:now(),status:'未取得原图',note:'',...(old?.pageHash?{pageHash:old.pageHash}:{})};
  try{
    let imageUrl=input.imageUrl?sourceUrl(input.imageUrl):'';
    if(!imageUrl){const page=await fetcher(url,{signal,maxBytes:6*1024*1024});const raw=await saveBuffer(store,dir,page.buffer,'source-preview-page.html');entry.pageHash=raw.hash;imageUrl=imageCandidate(page.buffer.toString('utf8'),page.url);}
    if(!imageUrl)throw new Error('来源页未提供可读取封面；可打开原网页查看');
    entry.imageUrl=imageUrl;
    const image=await fetcher(imageUrl,{signal,maxBytes:8*1024*1024}),name=imageName(image.buffer);
    const blob=await saveBuffer(store,dir,image.buffer,name);
    Object.assign(entry,{hash:blob.hash,status:'原图已保存',mime:blob.mime,bytes:blob.size,note:'来源网页原图；使用权待核对'});
  }catch(e){if(signal?.aborted)throw e;entry.note=String(e.message).slice(0,350);}
  const cache=store.get('discovery.media')||{};cache[hash(url)]=entry;store.set('discovery.media',cache);return entry;
}
export function decorateDigest(store,digest){
  if(!digest)return null;
  const media=store.get('discovery.media')||{};
  const news=digest.payload.news.map(n=>({...n,channel:newsChannel(n),media:media[hash(n.sources[0].url)]||null}));
  const people=new Set(news.filter(n=>n.channel==='people').map(n=>n.person||n.title)).size;
  return {...digest,payload:{...digest.payload,news},peopleProgress:{actual:people,target:10,missing:Math.max(0,10-people)}};
}
