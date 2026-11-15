// Short labels for videos and citations. Imported data keeps the original title.
export function compactTitle(value, limit = 48) {
  const full = String(value || '').replace(/\s+/g, ' ').replace(/\s*[-–—|｜]\s*YouTube\s*$/i, '').trim();
  const chars = Array.from(full);
  if (chars.length <= limit) return full;
  const head = chars.slice(0, limit - 1).join('');
  const boundary = Math.max(head.lastIndexOf('｜'), head.lastIndexOf(' | '), head.lastIndexOf('／'));
  return `${(boundary >= limit / 2 ? head.slice(0, boundary) : head).trim()}…`;
}

export const youtubeUrl = (id, seconds = 0) => `https://youtu.be/${id}${seconds > 0 ? `?t=${Math.floor(seconds)}` : ''}`;

export function compactUrl(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    const youtube = /^(?:(?:www|m|music)\.)?youtube\.com$/.test(u.hostname);
    const id = youtube ? (u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1])
      : u.hostname === 'youtu.be' ? u.pathname.slice(1) : null;
    if (/^[\w-]{11}$/.test(id || '')) {
      const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
      const seconds = /^\d+$/.test(t) ? Number(t) : /^(?:\d+h)?(?:\d+m)?(?:\d+s)?$/.test(t)
        ? Number(t.match(/(\d+)h/)?.[1] || 0) * 3600 + Number(t.match(/(\d+)m/)?.[1] || 0) * 60 + Number(t.match(/(\d+)s/)?.[1] || 0) : 0;
      return youtubeUrl(id, seconds);
    }
    return u.href;
  } catch { return null; }
}

export function sourceHtml(value, esc) {
  const text = String(value || '');
  const re = /https?:\/\/[^\s<>"'（）()「」【】、。]+/g;
  let html = ''; let at = 0;
  for (const m of text.matchAll(re)) {
    html += esc(compactTitle(text.slice(at, m.index), 60));
    const url = compactUrl(m[0]);
    const label = url ? compactTitle(url.replace(/^https?:\/\//, ''), 42) : m[0];
    html += url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(m[0]);
    at = m.index + m[0].length;
  }
  return html + esc(compactTitle(text.slice(at), 60));
}
