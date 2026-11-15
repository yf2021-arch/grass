"""Upload the completed pack through the existing authenticated Grass API."""
import base64
import json
import time
import urllib.request
from pathlib import Path

CHUNK = 1024 * 1024  # Drive requires multiples of 256 KiB except the final chunk.

def api_call(url, token, body):
    req = urllib.request.Request(url, data=json.dumps({**body, 'token': token}).encode('utf-8'),
        headers={'Content-Type': 'text/plain;charset=utf-8'}, method='POST')
    with urllib.request.urlopen(req, timeout=120) as response:
        result = json.loads(response.read().decode('utf-8'))
    if not result.get('ok'):
        raise RuntimeError(result.get('error', 'Upload failed'))
    return result

def upload_pack(path, url, token):
    path = Path(path)
    size = path.stat().st_size
    start = api_call(url, token, {'action': 'audioUploadStart', 'size': size})
    session = start['session']
    offset = 0
    with path.open('rb') as source:
        while offset < size:
            source.seek(offset)
            data = source.read(CHUNK)
            for attempt in range(4):
                try:
                    result = api_call(url, token, {'action': 'audioUploadChunk', 'session': session,
                        'offset': offset, 'data': base64.b64encode(data).decode('ascii')})
                    break
                except Exception:
                    # Query Drive before retrying: the chunk may already have arrived.
                    if attempt == 3:
                        raise
                    time.sleep(attempt + 1)
                    result = api_call(url, token, {'action': 'audioUploadStatus', 'session': session})
                    if result.get('done') or result.get('next', 0) != offset:
                        break
            next_offset = size if result.get('done') else result['next']
            if next_offset <= offset or next_offset > size:
                raise RuntimeError('Drive returned an invalid upload position')
            offset = next_offset
            print(f'Drive: {offset * 100 // size}%')
    if not result.get('done'):
        raise RuntimeError('Drive did not confirm the completed upload')
    return result
