const VIDEO_ID = /^[\w-]{11}$/;

// Accepts a bare video id or any common YouTube link (watch, youtu.be, embed,
// shorts, live, nocookie) and returns the 11-character video id, or null when
// the input isn't recognisably a YouTube video.
export function parseYoutubeId(input) {
  const text = String(input ?? '').trim();
  if (VIDEO_ID.test(text)) return text;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : /^\/(?:embed|shorts|live|v)\/([^/]+)/.exec(url.pathname)?.[1];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

export default parseYoutubeId;
