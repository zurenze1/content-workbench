#!/bin/zsh
set -e
WORKBENCH_ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$WORKBENCH_ROOT"
if ! command -v node >/dev/null 2>&1; then
  WORKBENCH_NODE_BIN="$HOME/Documents/Codex/tools/node/bin"
  if [ -x "$WORKBENCH_NODE_BIN/node" ]; then export PATH="$WORKBENCH_NODE_BIN:$PATH"; fi
fi
node --input-type=module -e 'if(process.versions.node.split(".")[0]!=="24"){console.error("请使用Node.js 24.21.0或24.x。");process.exit(1)}'
if [ ! -d node_modules ]; then npm ci --ignore-scripts; fi
if [ ! -f dist/index.html ]; then npm run build; fi
printf '\n工作台地址：http://127.0.0.1:4781/\n请在浏览器打开；保留此终端运行。退出时按Ctrl+C。\n\n'
npm start
