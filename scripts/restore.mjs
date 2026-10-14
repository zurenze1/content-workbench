import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {inspectBackup,restoreInspected} from '../server/backup.mjs';
const args=process.argv.slice(2),i=args.indexOf('--data');if(!args[0]||i<0||!args.includes('--confirm')){console.error('用法：npm run restore -- /完整备份.tar.gz --data /新的数据目录 --confirm\n只恢复到不存在的新目录，不覆盖原数据。');process.exit(1);}const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-restore-'));try{const preview=await inspectBackup(path.resolve(args[0]),tmp);const result=await restoreInspected(preview,path.resolve(args[i+1]),{confirm:true});console.log(JSON.stringify(result,null,2));}finally{await fs.rm(tmp,{recursive:true,force:true});}
