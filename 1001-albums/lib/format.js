import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function streamingLinks(album) {
  const links = [];
  if (!album) return links;
  if (album.spotifyId) links.push({ service: 'Spotify', url: `https://open.spotify.com/album/${album.spotifyId}` });
  if (album.appleMusicId) links.push({ service: 'Apple Music', url: `https://music.apple.com/album/${album.appleMusicId}` });
  if (album.tidalId) links.push({ service: 'Tidal', url: `https://tidal.com/browse/album/${album.tidalId}` });
  if (album.amazonMusicId) links.push({ service: 'Amazon Music', url: `https://music.amazon.com/albums/${album.amazonMusicId}` });
  if (album.youtubeMusicId) links.push({ service: 'YouTube Music', url: `https://music.youtube.com/playlist?list=${album.youtubeMusicId}` });
  if (album.deezerId) links.push({ service: 'Deezer', url: `https://www.deezer.com/album/${album.deezerId}` });
  if (album.qobuzId) links.push({ service: 'Qobuz', url: `https://open.qobuz.com/album/${album.qobuzId}` });
  return links;
}

export function wikipediaTitleFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const i = path.indexOf('/wiki/');
    return i === -1 ? null : decodeURIComponent(path.slice(i + 6));
  } catch {
    return null;
  }
}

export function modalFrameUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'en.wikipedia.org') {
      parsed.hostname = 'en.m.wikipedia.org';
      return parsed.toString();
    }
  } catch {}
  return url;
}

export function parseGlobalReviews(htmlText, limit = 25) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  return [...doc.querySelectorAll('.review-card')]
    .map(card => {
      const ratingLabel = card.querySelector('.review-card--stars')?.getAttribute('aria-label') || '';
      const rating = ratingLabel.match(/Rated\s+(\d)/)?.[1] || null;
      const review = card.querySelector('.review-card--text')?.textContent.trim() || '';
      const date = card.querySelector('.review-card--date')?.textContent.trim() || '';
      return { rating, review, date };
    })
    .filter(r => r.review)
    .slice(0, limit);
}

export function parseGlobalAlbumContext(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const stats = {};
  doc.querySelectorAll('.stat-item').forEach(item => {
    const label = item.querySelector('.stat-label')?.textContent.trim();
    const value = item.querySelector('.stat-value')?.textContent.trim();
    if (label && value) stats[label.toLowerCase()] = value;
  });
  const distribution = [...doc.querySelectorAll('.rating-bar')]
    .map(bar => ({
      label: bar.querySelector('.rating-bar-label')?.textContent.trim() || '',
      percent: bar.querySelector('.rating-bar-percent')?.textContent.trim() || bar.getAttribute('data-percent') || '',
    }))
    .filter(row => row.label && row.percent);
  const metadata = [...doc.querySelectorAll('.album-metadata span')]
    .map(span => span.textContent.trim())
    .filter(Boolean);
  const keywords = [...doc.querySelectorAll('.keyword-cloud .keyword')]
    .map(keyword => keyword.textContent.trim())
    .filter(Boolean);
  const streamingLinks = [...doc.querySelectorAll('.streaming-links a.streaming-link')]
    .map(a => {
      let url = a.getAttribute('href') || '';
      if (url.startsWith('spotify:album:')) url = `https://open.spotify.com/album/${url.slice(14)}`;
      const ytMatch = url.match(/youtube\.com\/results\?search_query=(.+)/);
      if (ytMatch) url = `https://music.youtube.com/search?q=${ytMatch[1]}`;
      const service = (a.getAttribute('aria-label') || '').replace(/^(Open in |Open on |Listen on |Search on )/i, '');
      return service && url ? { service, url } : null;
    })
    .filter(Boolean);
  const wikipediaUrl = (() => {
    const a = doc.querySelector('a[href*="wikipedia.org/wiki/"]');
    return a ? a.getAttribute('href') : null;
  })();
  return { stats, distribution, metadata, keywords, streamingLinks, wikipediaUrl };
}

// A previous bad fetch (rate limit, CORS/CDN hiccup) is indistinguishable from a legitimately
// review-less album by shape alone, so this is a heuristic, not a guarantee — but it's the same
// trade-off already accepted for Apple track lookups, and far better than caching a bad result
// forever with no way to recover.
export function isGlobalAlbumPageEmpty(value) {
  const noReviews = !value.reviews || value.reviews.length === 0;
  const noContext = !value.context || (value.context.distribution.length === 0 && value.context.keywords.length === 0);
  return noReviews && noContext;
}

export function formatRating(value) {
  if (value == null) return '—';
  if (value === 'did-not-listen') return 'DNL';
  return value;
}

// Notification `type` values observed live: groupReview, albumsRated, groupAlbumsGenerated,
// custom, newGroupMember, donationPush, signup. Undocumented, so unknown future types fall
// back to just showing the raw type name rather than breaking.
export function formatNotifTime(date) {
  const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const day = date.getDate();
  const time = date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${month} ${day} · ${time}`;
}

export function formatNotification(n) {
  const d = n.data || {};
  switch (n.type) {
    case 'groupReview':
      return { prefix: '', albumName: d.albumName, suffix: ` was rated ${d.rating}/5 by ${d.projectName}`, albumId: d.albumId };
    case 'albumsRated':
      return { text: `You've rated ${d.numberOfAlbums} albums` };
    case 'groupAlbumsGenerated':
      return { text: `Your group has generated ${d.numberOfAlbums} albums` };
    case 'custom':
      return { text: d.heading ? `${d.heading} — ${d.body || ''}` : (d.body || 'Announcement') };
    case 'newGroupMember':
      return { text: 'A new member joined your group' };
    case 'donationPush':
      return { text: 'Reminder to support the site' };
    case 'signup':
      return { text: 'Project created — welcome!' };
    default:
      return { text: n.type };
  }
}

export function ratingTier(avg) {
  return avg >= 5 ? 'perfect' : avg >= 4 ? 'green' : avg >= 3 ? 'yellow' : avg >= 2 ? 'orange' : 'red';
}

export function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function discoveryLinks(album) {
  const query = `${album.name} ${album.artist}`;
  const videoContextQuery = `${query} album (documentary OR background OR analysis OR "story behind" OR making-of OR interview)`;
  return [
    { label: 'Discogs', url: `https://www.discogs.com/search/?q=${encodeURIComponent(query)}&type=all` },
    { label: 'RateYourMusic', url: `https://rateyourmusic.com/search?searchterm=${encodeURIComponent(query)}&searchtype=l` },
    { label: 'MusicBrainz', url: `https://musicbrainz.org/search?query=${encodeURIComponent(query)}&type=release&method=indexed` },
    { label: 'AOTY', url: `https://www.albumoftheyear.org/search/?q=${encodeURIComponent(query)}` },
    { label: 'Musicboard', url: `https://musicboard.app/search/${encodeURIComponent(query.toLowerCase())}/album` },
    { label: 'YouTube', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(videoContextQuery)}` },
  ];
}

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightKeyword(text, keyword) {
  if (!keyword) return text;
  const pattern = new RegExp(`(\\b${escapeRegExp(keyword)}\\b)`, 'gi');
  return text.split(pattern).map((part, i) => (i % 2 === 1 ? html`<mark class="keyword-highlight">${part}</mark>` : part));
}

export function formatCacheAge(fetchedAt) {
  const ms = Date.now() - fetchedAt;
  const days = Math.floor(ms / 86400000);
  if (days > 0) return `${days} day${days !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(ms / 3600000);
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  return 'just now';
}
