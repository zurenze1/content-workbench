import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runCodex,codexStatus} from '../server/codex.mjs';

test('Codex流协议模拟：重连后成功不误报失败，最终失败保留错误',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-codex-protocol-')),file=path.join(dir,'codex-mock');const previous=process.env.WORKBENCH_CODEX_BIN;
  try{
    const script=`#!${process.execPath}\nif(process.argv.includes('status')){console.log('Logged in using ChatGPT');process.exit(0);}let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const emit=o=>console.log(JSON.stringify(o));emit({type:'error',message:'Reconnecting...'});emit({type:'item.completed',item:{type:'agent_message',text:'模拟协议回复'}});if(input.includes('FAIL')){emit({type:'turn.failed',error:{message:'最终连接失败'}});process.exitCode=1;}else emit({type:'turn.completed',usage:{output_tokens:4}});});`;
    await fs.writeFile(file,script,{mode:0o700});process.env.WORKBENCH_CODEX_BIN=file;codexStatus(true);
    const r=await runCodex({prompt:'成功分支',model:'fixture-model'});assert.equal(r.text,'模拟协议回复');assert.equal(r.usage.output_tokens,4);
    await assert.rejects(()=>runCodex({prompt:'FAIL',model:'fixture-model'}),/最终连接失败/);
  }finally{if(previous===undefined)delete process.env.WORKBENCH_CODEX_BIN;else process.env.WORKBENCH_CODEX_BIN=previous;codexStatus(true);await fs.rm(dir,{recursive:true,force:true});}
});
