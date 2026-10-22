import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';

export function codexBinary(){
  const names=[process.env.WORKBENCH_CODEX_BIN,'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex','/Applications/Codex.app/Contents/Resources/codex',...(process.env.PATH||'').split(path.delimiter).map(d=>path.join(d,'codex'))];
  return names.find(p=>p&&fs.existsSync(p))||null;
}
let cached=null,checked=0;
export function codexStatus(force=false){
  if(cached&&!force&&Date.now()-checked<60000)return cached;
  const bin=codexBinary();let loggedIn=false;
  if(bin)try{const r=spawnSync(bin,['login','status'],{encoding:'utf8',timeout:8000,stdio:['ignore','pipe','pipe']});loggedIn=r.status===0&&/Logged in using ChatGPT|Logged in using an API key/i.test(String(r.stdout)+String(r.stderr));}catch{}
  checked=Date.now();cached={installed:!!bin,loggedIn,state:!bin?'未安装 Codex':!loggedIn?'请先在 Codex 登录':'ChatGPT 已连接'};return cached;
}

let modelCache=null;
export async function codexModels(force=false){
  if(modelCache&&!force)return modelCache;
  const bin=codexBinary();if(!bin)throw new Error('未找到 Codex CLI');
  const p=spawn(bin,['app-server'],{stdio:['pipe','pipe','pipe']});
  let seq=0;const pending=new Map();const rl=createInterface({input:p.stdout});
  const close=()=>{rl.close();p.kill();};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Codex 模型列表读取超时'));},15000);pending.set(id,{resolve,reject,timer});p.stdin.write(JSON.stringify({id,method,params})+'\n');});
  rl.on('line',line=>{try{const m=JSON.parse(line),w=pending.get(m.id);if(w){clearTimeout(w.timer);pending.delete(m.id);m.error?w.reject(new Error(m.error.message)):w.resolve(m.result);}}catch{}});
  const rejectAll=()=>{for(const w of pending.values()){clearTimeout(w.timer);w.reject(new Error('Codex 连接已关闭'));}pending.clear();};
  p.on('error',rejectAll);p.on('exit',rejectAll);p.stdin.on('error',()=>{});p.stderr.resume();
  try{await call('initialize',{clientInfo:{name:'zrz_content_workbench',version:'0.3.0'}});p.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');const r=await call('model/list',{});modelCache=r.data.filter(m=>!m.hidden).map(m=>({id:m.model,name:m.displayName,efforts:m.supportedReasoningEfforts.map(e=>e.reasoningEffort),default:m.isDefault}));return modelCache;}finally{close();}
}

// Each invocation is ephemeral, has no user MCP configuration, and cannot write files.
// Only the explicitly supplied conversation and selected textual evidence enter the prompt.
export async function runCodex({prompt,model,effort='low',signal,onText=()=>{},schemaPath}){
  if(!codexStatus().loggedIn)throw new Error('请先在 Codex 登录 ChatGPT，然后重新连接');
  const cwd=path.join(os.tmpdir(),'zrz-workbench-model');fs.mkdirSync(cwd,{recursive:true,mode:0o700});
  const args=['exec','--ignore-user-config','--ephemeral','--sandbox','read-only','--skip-git-repo-check','--json','--color','never','-C',cwd,'-m',model,'-c',`model_reasoning_effort=${JSON.stringify(effort)}`,'-c','features.shell_tool=false','-c','features.multi_agent=false'];
  // This Mac's WebSocket route presents an unrelated certificate. Use Codex's
  // supported HTTPS/SSE transport, with normal TLS validation and native auth.
  args.push('-c','model_provider="zrz_chatgpt_http"','-c','model_providers.zrz_chatgpt_http={name="OpenAI ChatGPT HTTPS",base_url="https://chatgpt.com/backend-api/codex",requires_openai_auth=true,supports_websockets=false,wire_api="responses"}');
  if(schemaPath)args.push('--output-schema',schemaPath);args.push('-');
  return await new Promise((resolve,reject)=>{
    const p=spawn(codexBinary(),args,{stdio:['pipe','pipe','pipe'],env:{...process.env,CODEX_INTERNAL_ORIGINATOR_OVERRIDE:'zrz_content_workbench'}});
    const rl=createInterface({input:p.stdout});let content='',usage={},issue='',stderr='',settled=false;
    const kill=()=>{p.kill('SIGTERM');setTimeout(()=>{if(p.exitCode===null&&p.signalCode===null)p.kill('SIGKILL');},1500).unref();};
    const timer=setTimeout(()=>{issue='模型响应超时，请重试或降低推理强度';kill();},100000);
    const abort=()=>{issue='模型请求已取消';kill();};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    rl.on('line',line=>{try{const e=JSON.parse(line);if(e.type==='item.completed'&&e.item?.type==='agent_message'){content=e.item.text||content;onText(content);}if(e.type==='turn.completed'){usage=e.usage||{};issue='';}if(e.type==='turn.failed')issue=e.error?.message||'模型请求失败';if(e.type==='error')issue=e.message||'模型连接失败';}catch{}});
    p.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-1500);});p.stdin.on('error',()=>{});
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);rl.close();error?reject(error):resolve({text:content,model,usage});};
    p.on('error',()=>finish(new Error('无法启动 Codex，请检查安装路径')));
    p.on('close',code=>{if(issue||code!==0||!content)finish(new Error((issue||stderr||'模型没有返回文字').replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_.-]+/g,'[已隐藏]').slice(0,500)));else finish();});
    p.stdin.end(prompt);
  });
}
