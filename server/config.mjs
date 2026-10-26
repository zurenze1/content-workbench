import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
export const APP_VERSION='0.9.1';
export const DEFAULT_DATA=path.join(os.homedir(),process.platform==='darwin'?'Library/Application Support':' .local/share'.trim(),'Content Workbench','data');
export function config(argv=process.argv.slice(2)) {
  const option=(key,fallback)=>{const i=argv.indexOf(key);return i<0?fallback:argv[i+1];};
  const dir=path.resolve(option('--data',process.env.WORKBENCH_DATA_DIR||DEFAULT_DATA));
  const port=Number(option('--port',process.env.WORKBENCH_PORT||4781));
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('无效端口');
  for(const name of ['blobs','staging','backups','restored'])fs.mkdirSync(path.join(dir,name),{recursive:true,mode:0o700});
  return {dir,port,origin:`http://127.0.0.1:${port}`,db:path.join(dir,'workbench.sqlite'),maxFile:1024*1024*1024,maxDocumentParse:12*1024*1024,timezone:'Asia/Shanghai'};
}
