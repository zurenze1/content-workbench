#!/bin/zsh
# 桌面图标调用：服务未运行时在后台启动，等待可访问后用 Chrome 打开工作台。
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
URL="http://127.0.0.1:4781/"
LOG="$HOME/Library/Logs/祖仁泽自媒体工作台.log"
export PATH="$HOME/Documents/Codex/tools/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
up() { curl --noproxy '*' -fsS -m 2 "${URL}api/bootstrap" >/dev/null 2>&1 }
alert() { osascript -e "display alert \"祖仁泽自媒体工作台\" message \"$1\"" >/dev/null 2>&1 }
if ! up; then
  cd "$ROOT" || { alert "找不到工作台程序目录：$ROOT"; exit 1; }
  if ! node -e 'process.exit(process.versions.node.split(".")[0]==="24"?0:1)' 2>/dev/null; then alert "需要 Node.js 24.x，请先安装后再打开。"; exit 1; fi
  [ -d node_modules ] || npm ci --ignore-scripts >>"$LOG" 2>&1
  [ -f dist/index.html ] || npm run build >>"$LOG" 2>&1
  print "\n==== $(date '+%Y-%m-%d %H:%M:%S') 启动 ====" >>"$LOG"
  nohup node server/main.mjs >>"$LOG" 2>&1 &
  for i in {1..60}; do up && break; sleep 0.5; done
  up || { alert "本地服务没有启动成功，请查看日志：$LOG"; exit 1; }
fi
if [ "${1:-}" = "--server-only" ]; then exit 0; fi
if [ -d "/Applications/Google Chrome.app" ]; then open -a "Google Chrome" "$URL"; else open "$URL"; fi
