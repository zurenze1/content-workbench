// Local bridge for the existing Codex 09:00 automation. No account tokens are read.
import fsp from 'node:fs/promises';
import {config} from '../server/config.mjs';
import {Store} from '../server/store.mjs';
import {creators,ingestDaily,dailyStatus} from '../server/discovery.mjs';
import {events} from '../server/public-events.mjs';
const args=process.argv.slice(2),cfg=config(args),store=new Store(cfg.db);
try{
  if(args[0]==='context')console.log(JSON.stringify({creators:creators(store).filter(a=>a.follow),collector:store.get('discovery.collector')||null,automation:dailyStatus(store),dailyRequirements:{peopleTarget:10,channels:['people','culture','ai','other'],peopleUniqueBy:'person',image:'imageUrl must be the actual source image; unavailable stays empty'},existingEvents:events(store).slice(-200)},null,2));
  else if(args[0]==='import'){
    const pos=args.indexOf('--file');if(pos<0||!args[pos+1])throw new Error('请指定 --file 日报.json');
    const stat=await fsp.stat(args[pos+1]);if(stat.size>2*1024*1024)throw new Error('日报文件超过2MB');
    console.log(JSON.stringify(await ingestDaily(store,cfg.dir,JSON.parse(await fsp.readFile(args[pos+1],'utf8'))),null,2));
  }else throw new Error('使用 context 或 import --file 日报.json，可加 --data 独立目录');
}catch(e){console.error(e.message);process.exitCode=1;}finally{store.close();}
