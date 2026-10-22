"""Use installed, cached SenseVoice models only. Never download or polish the transcript."""
import argparse
import json
import os
import re
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('audio')
p.add_argument('output')
args = p.parse_args()
root = Path(os.environ.get('WORKBENCH_ASR_CACHE', str(Path.home() / '.codex/skills/funasr-transcribe/.modelscope/models/iic')))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from funasr import AutoModel
import torch
torch.set_num_threads(4)
device = 'mps' if torch.backends.mps.is_available() else 'cpu'
model = AutoModel(model=str(root / 'SenseVoiceSmall'),
                  vad_model=str(root / 'speech_fsmn_vad_zh-cn-16k-common-pytorch'),
                  punc_model=str(root / 'punc_ct-transformer_zh-cn-common-vocab272727-pytorch'),
                  device=device, disable_update=True, ncpu=4, disable_pbar=True)
result = model.generate(input=args.audio, batch_size_s=60)
parts = [re.sub(r'<\|[^>]+\|>', '', r.get('text', '')).strip() for r in result if isinstance(r, dict)]
body = '\n'.join(s for s in parts if s)
Path(args.output).write_text(json.dumps({'text': body, 'engine': 'SenseVoiceSmall + VAD + 标点',
                                       'device': device, 'timestamps': False, 'reviewed': False}, ensure_ascii=False), encoding='utf-8')
