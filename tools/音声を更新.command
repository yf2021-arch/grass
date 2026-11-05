#!/bin/bash
cd "$(dirname "$0")/.."
python3 tools/make_card_audio.py "$@"
echo
read -n 1 -s -r -p "何かキーを押すと閉じます"
