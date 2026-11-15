"""Reuse finished packs as the audio cache; publish replacements atomically."""
import json
import os
import shutil
import struct
from pathlib import Path

MAGIC = b'GRASSPK1'

def index_pack(path):
    path = Path(path)
    if not path.exists():
        return {}, 0
    with path.open('rb') as f:
        if f.read(8) != MAGIC:
            raise ValueError('Previous audio pack has an invalid signature')
        raw = f.read(4)
        if len(raw) != 4:
            raise ValueError('Previous audio pack is truncated')
        length = struct.unpack('<I', raw)[0]
        if length > 20 * 1024 * 1024:
            raise ValueError('Audio pack header is too large')
        header = json.loads(f.read(length))
    base = 12 + length
    size = path.stat().st_size
    for item in header.get('files', {}).values():
        if not isinstance(item['off'], int) or not isinstance(item['len'], int) or item['off'] < 0 or item['len'] <= 0 or base + item['off'] + item['len'] > size:
            raise ValueError('Previous audio pack has invalid audio offsets')
        if Path(item['name']).name != item['name']:
            raise ValueError('Invalid audio filename')
    return {v['name']: v for v in header.get('files', {}).values()}, base

def restore_clip(pack, index, base, name, dest):
    item = index.get(name)
    if item is None:
        return False
    with Path(pack).open('rb') as source, Path(dest).open('wb') as target:
        source.seek(base + item['off'])
        data = source.read(item['len'])
        if len(data) != item['len']:
            raise ValueError('Audio pack is truncated')
        target.write(data)
    return True

def write_pack(pack, header, clips):
    pack, clips = Path(pack), Path(clips)
    placed = {}
    offset = 0
    for info in header['files'].values():
        name = info['name']
        if name not in placed:
            size = (clips / name).stat().st_size
            if size <= 0:
                raise ValueError('Empty audio file')
            placed[name] = (offset, size)
            offset += size
        info['off'], info['len'] = placed[name]
    hb = json.dumps(header, ensure_ascii=False).encode('utf-8')
    tmp = pack.with_suffix('.pack.tmp')
    try:
        with tmp.open('wb') as out:
            out.write(MAGIC + struct.pack('<I', len(hb)) + hb)
            for name in placed:
                with (clips / name).open('rb') as source:
                    shutil.copyfileobj(source, out)
        index_pack(tmp)
        os.replace(tmp, pack)
    finally:
        tmp.unlink(missing_ok=True)

def clean_clips(out):
    out = Path(out).resolve()
    clips = out / 'clips'
    if clips.is_symlink() or clips.resolve().parent != out:
        raise ValueError('Refusing to clean an unexpected clips path')
    if clips.exists():
        shutil.rmtree(clips)
