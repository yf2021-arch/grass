import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import make_card_audio as kit
from audio_pack_cache import index_pack

class AudioKitTests(unittest.TestCase):
    def test_reuses_pack_after_clips_are_removed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            csv = root / 'cards.csv'
            csv.write_text('ID,言語,表現,読み,品詞・型\nJP-test,ja,書く,かく,動詞（五段）\n', encoding='utf-8')
            out = root / 'audio'
            drill = [{'id': 'KT-書く', 'key': 'te', 'text': '書いて', 'yomi': 'かいて'}]
            calls = []
            def request(engine, path, **kwargs):
                calls.append(path)
                return b'RIFF fake audio' if path == '/synthesis' else {'accent_phrases': []}
            argv = ['kit', '--csv', str(csv), '--out', str(out), '--speaker', '1']
            with patch.object(sys, 'argv', argv), patch.object(kit, 'speakers', return_value=[]), \
                 patch.object(kit, 'style_name', return_value=('test', 'test', {})), \
                 patch.object(kit, 'request', side_effect=request), patch.object(kit, 'make_query', return_value=({}, False)), \
                 patch.object(kit.shutil, 'which', return_value=None), \
                 patch.object(kit.subprocess, 'run', return_value=type('Result', (), {'stdout': json.dumps(drill)})()), \
                 contextlib.redirect_stdout(io.StringIO()):
                kit.main()
                self.assertFalse((out / 'clips').exists())
                first = calls.count('/synthesis')
                self.assertEqual(first, 2)
                kit.main()
                self.assertEqual(calls.count('/synthesis'), first, 'no repeated synthesis after loose clips cleanup')
                self.assertFalse((out / 'clips').exists())
                index, _ = index_pack(out / 'grass-card-audio.pack')
                self.assertEqual(len(index), 2)
                self.assertIn('KT-書く:te', json.loads((out / 'last.json').read_text(encoding='utf-8')))

if __name__ == '__main__':
    unittest.main()
