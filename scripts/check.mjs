import {readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const dirs=['server','scripts','tests'];let count=0;for(const dir of dirs){for(const name of await readdir(dir)){if(!name.endsWith('.mjs'))continue;execFileSync(process.execPath,['--check',dir+'/'+name],{stdio:'pipe'});count++;}}console.log(`${count} 个服务/脚本/测试文件语法检查通过`);
