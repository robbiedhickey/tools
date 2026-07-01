import { h, Fragment } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import htm from 'htm';
import { useCachedFetch, globalAlbumPageCacheKey } from '../lib/cache.js';
import { fetchGlobalAlbumPage, fetchAlbumTrackRecord, fetchGroupAlbumReviews, formatCacheErrorMessage } from '../lib/api.js';
import {
  wikipediaTitleFromUrl, isGlobalAlbumPageEmpty, formatRating, discoveryLinks, ratingTier,
  escapeRegExp, highlightKeyword, formatDurationMs,
} from '../lib/format.js';
import { discoverGenreStyleRoutePath, navigateForward } from '../lib/routing.js';
import { useFavoriteTracks, favoriteTrackId } from '../lib/favorites.js';
import { useMusicService, useEmbeddablePlayers } from '../lib/settings.js';
import { SiteModalLink } from './common.js';
import { trackEmbed } from './player.js';
import { SimilarAlbumsHelper } from './explore.js';

const html = htm.bind(h);

// The real site shows a one-paragraph Wikipedia extract inline (click to expand) rather than
// just linking out. There's no API for that on their end — it's rendered server-side from their
// own DB — but Wikipedia's own REST summary endpoint is public and CORS-open for any origin, so
// we can fetch the same kind of extract straight from Wikipedia using the title baked into the
// article URL the 1001albumsgenerator API already gives us.
export function WikipediaSummary({ url }) {
  const cacheKey = url ? `wiki-summary:v1:${url}` : null;
  const { status, value: data } = useCachedFetch(
    cacheKey,
    () => {
      const title = wikipediaTitleFromUrl(url);
      if (!title) return Promise.reject(new Error('no title'));
      return fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
        .then((r) => { if (!r.ok) throw new Error('lookup failed'); return r.json(); });
    },
    { isEmpty: (v) => !v || !v.extract }
  );

  if (status === 'hidden' || status === 'error') return null;

  return html`
    <div class="wiki-summary">
      ${status === 'ready' && data && html`
        <p>${data.extract}</p>
        <${SiteModalLink} href=${(data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page) || url} title="Wikipedia" className="">Full Wikipedia Article →<//>
      `}
    </div>
  `;
}

export function normalizeStoredTrack(track, album, record) {
  const spotify = track.services?.spotify || {};
  const apple = track.services?.appleMusic || {};
  return {
    discNumber: track.discNumber ?? 1,
    trackNumber: track.trackNumber ?? null,
    title: track.title || '',
    durationMs: track.durationMs ?? null,
    artistName: track.artist ?? track.artistName ?? album?.artist ?? album?.artistName ?? null,
    albumName: track.albumName ?? album?.name ?? album?.albumName ?? null,
    appleTrackId: apple.trackId ?? track.appleTrackId ?? null,
    appleAlbumId: record?.services?.appleMusic?.albumId ?? track.appleAlbumId ?? album?.appleAlbumId ?? null,
    spotifyTrackId: spotify.trackId ?? track.spotifyTrackId ?? null,
    spotifyAlbumId: record?.spotifyAlbumId ?? album?.spotifyAlbumId ?? null,
    trackViewUrl: apple.url || track.trackViewUrl || spotify.url || (spotify.trackId ? `https://open.spotify.com/track/${spotify.trackId}` : null),
    artworkUrl: track.artworkUrl || album?.images?.[0]?.url || null,
    explicit: typeof track.explicit === 'boolean' ? track.explicit : null,
    streamable: typeof track.streamable === 'boolean' ? track.streamable : null,
  };
}

export function parseStoredTrackAlbum(record) {
  if (!record || !Array.isArray(record.tracks)) return null;
  const album = record.album || null;
  const tracks = record.tracks
    .map(track => normalizeStoredTrack(track, album, record))
    .sort((a, b) =>
      (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
      (a.trackNumber ?? 0) - (b.trackNumber ?? 0)
    );
  return {
    album: album ? {
      albumName: album.name || album.albumName || null,
      artistName: album.artist || album.artistName || null,
      releaseDate: album.releaseDate || null,
      trackCount: album.trackCount ?? tracks.length,
      totalRuntimeMs: album.totalRuntimeMs ?? (tracks.reduce((sum, track) => sum + (track.durationMs || 0), 0) || null),
      copyright: album.copyright || null,
      appleAlbumId: record.services?.appleMusic?.albumId || album.appleAlbumId || null,
      spotifyAlbumId: record.spotifyAlbumId || album.spotifyAlbumId || null,
      wikipediaUrl: record.services?.wikipedia?.url || album.wikipediaUrl || null,
    } : null,
    tracks,
    source: 'kv',
  };
}

export function isTrackMetadataEmpty(value) {
  return !value || !value.tracks || value.tracks.length === 0;
}

export function useAlbumTrackMetadata(album) {
  const [state, setState] = useState({ status: 'hidden', data: null, error: null, source: null });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const spotifyId = album?.spotifyId || null;

  useEffect(() => {
    if (!spotifyId) {
      setState({ status: 'hidden', data: null, error: null, source: null });
      return;
    }

    let cancelled = false;
    const force = refreshNonce > 0;
    setState({ status: 'loading', data: null, error: null, source: null });

    (async () => {
      if (spotifyId) {
        const stored = parseStoredTrackAlbum(await fetchAlbumTrackRecord(spotifyId, { force }));
        if (stored && !isTrackMetadataEmpty(stored)) {
          return { data: stored, source: 'kv' };
        }
      }
      return { data: null, source: null };
    })()
      .then(({ data, source }) => {
        if (cancelled) return;
        if (data) setState({ status: 'ready', data, error: null, source });
        else setState({ status: 'hidden', data: null, error: null, source: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', data: null, error, source: null });
      });

    return () => { cancelled = true; };
  }, [spotifyId, refreshNonce]);

  return { ...state, refresh: () => setRefreshNonce(n => n + 1) };
}

// `sections` lets callers render only part of this panel (e.g. the Today page shows genres and
// rating elsewhere in the layout and only wants the rest here) — null means "show everything",
// matching every caller before this option existed.
export function AlbumSummaryContext({ album, projectName = null, discoverSource = 'global', comparison = null, sections = null }) {
  const show = (name) => !sections || sections.includes(name);
  // 'compare' also needs the fetched context: when nobody in this group's data has an entry for
  // the album yet (e.g. today's freshly-revealed pick), comparison.globalRating is null and we
  // fall back to the scraped per-album global rating below instead of showing a blank stat.
  const needsRatingFetch = show('rating') && !(album.averageRating || album.votes || album.controversialScore);
  const needsCompareFetch = show('compare') && comparison && comparison.globalRating == null;
  const needsFetch = needsRatingFetch || show('genres') || needsCompareFetch;
  const cache = useCachedFetch(
    needsFetch && album.globalReviewsUrl ? globalAlbumPageCacheKey(album.globalReviewsUrl) : null,
    () => fetchGlobalAlbumPage(album.globalReviewsUrl),
    { isEmpty: isGlobalAlbumPageEmpty }
  );
  const state = { status: cache.status, context: cache.value ? cache.value.context : null, errorMessage: formatCacheErrorMessage(cache.error) };

  const context = state.context;
  const links = discoveryLinks(album);

  return html`
    <div>
      ${show('compare') && comparison && html`
        <div class="context-section-title" data-badge="balance">How We Compare</div>
        <div class="context-grid context-grid--fixed">
          <div class="context-stat"><div class="value">${formatRating(comparison.userRating)}</div><div class="label">You</div></div>
          <div class="context-stat"><div class="value">${formatRating(comparison.groupAverage)}</div><div class="label">Group avg${comparison.groupVotes ? ` (${comparison.groupVotes})` : ''}</div></div>
          <div class="context-stat"><div class="value">${formatRating(comparison.globalRating != null ? comparison.globalRating : (context && context.stats.rating))}</div><div class="label">Global avg</div></div>
        </div>
      `}

      ${show('rating') && !(comparison && comparison.globalRating != null) && (album.averageRating || album.votes || album.controversialScore) && html`
        <div class="context-grid context-grid--fixed">
          <div class="context-stat"><div class="value">${album.averageRating ? album.averageRating.toFixed(2) + ' ★' : (context?.stats?.rating || '—')}</div><div class="label">Global rating</div></div>
          ${album.votes && html`<div class="context-stat"><div class="value">${album.votes.toLocaleString()}</div><div class="label">Votes</div></div>`}
          ${album.controversialScore && html`<div class="context-stat"><div class="value">${album.controversialScore.toFixed(2)}</div><div class="label">Controversy</div></div>`}
        </div>
      `}
      ${needsFetch && state.status === 'error' && html`<p class="muted">${state.errorMessage || "Couldn't load album details."}</p>`}
      ${state.status === 'ready' && context && html`
        ${show('rating') && !(comparison && comparison.globalRating != null) && !album.averageRating && context.stats.rating && html`
          <div class="context-grid">
            <div class="context-stat"><div class="value">${context.stats.rating}</div><div class="label">Global rating</div></div>
          </div>
        `}
        ${show('genres') && context.metadata.length > 0 && html`
          <div class="context-section-title" data-badge="sell">Genres & Styles</div>
          <div class="keyword-row">
            ${context.metadata.flatMap(entry => {
              const colonIndex = entry.indexOf(':');
              const tags = colonIndex === -1 ? entry : entry.slice(colonIndex + 1);
              return tags.split(',').map(t => t.trim()).filter(Boolean);
            }).map(tag => {
              const href = projectName ? discoverGenreStyleRoutePath(projectName, tag, discoverSource) : '';
              return href
                ? html`<a class="keyword-chip keyword-chip-link" href=${href} title=${`Explore ${tag}`} onClick=${(e) => { e.preventDefault(); navigateForward(href); }}>${tag}</a>`
                : html`<span class="keyword-chip">${tag}</span>`;
            })}
          </div>
          ${projectName && html`<${SimilarAlbumsHelper} album=${album} projectName=${projectName} source=${discoverSource} />`}
        `}
      `}

      ${show('discovery') && html`
        <div class="context-section-title" data-badge="explore">Discovery Links</div>
        <div class="discovery-row">
          ${links.map(link => html`<a class="link-chip" href=${link.url} target="_blank" rel="noopener">${link.label}</a>`)}
        </div>
      `}
    </div>
  `;
}


export function GlobalReviewsPreview({ url, initialKeyword = null }) {
  const cache = useCachedFetch(url ? globalAlbumPageCacheKey(url) : null, () => fetchGlobalAlbumPage(url), { isEmpty: isGlobalAlbumPageEmpty });
  const state = {
    status: cache.status,
    reviews: cache.value ? cache.value.reviews : [],
    context: cache.value ? cache.value.context : null,
    errorMessage: formatCacheErrorMessage(cache.error),
  };
  // Keyword chips are scraped from the site's own keyword cloud, which may be computed from more
  // reviews than the page actually embeds in static HTML — clicking one filters only the reviews
  // we actually loaded (see the "loaded reviews" wording below), not every review that mentions it.
  const [activeKeyword, setActiveKeyword] = useState(initialKeyword || null);
  const [activeRating, setActiveRating] = useState(null);

  useEffect(() => {
    setActiveKeyword(initialKeyword || null);
    setActiveRating(null);
  }, [url, initialKeyword]);

  const filteredReviews = useMemo(() => {
    if (!activeKeyword && !activeRating) return state.reviews;
    // Word-boundary match so e.g. "Fun" doesn't also match "function" or "funny".
    const pattern = activeKeyword ? new RegExp(`\\b${escapeRegExp(activeKeyword)}\\b`, 'i') : null;
    return state.reviews.filter(r =>
      (!pattern || pattern.test(r.review)) && (!activeRating || Number(r.rating) === activeRating)
    );
  }, [state.reviews, activeKeyword, activeRating]);

  const hasActiveFilter = activeKeyword || activeRating;
  const clearFilters = () => { setActiveKeyword(null); setActiveRating(null); };

  return html`
    <div>
      ${state.status === 'error' && html`<p class="muted">${state.errorMessage || "Couldn't load global reviews."}</p>`}
      ${state.status === 'ready' && html`
        ${state.context && html`
          ${state.context.distribution.length > 0 && html`
            <div class="context-section-title" data-badge="bar_chart">Distribution</div>
            <div class="distribution-bars">
              ${state.context.distribution.map(row => {
                const ratingValue = Number(row.label);
                const clickable = Number.isFinite(ratingValue);
                const isActive = clickable && activeRating === ratingValue;
                const Tag = clickable ? 'button' : 'div';
                return html`
                  <${Tag}
                    type=${clickable ? 'button' : undefined}
                    class=${`distribution-row ${clickable ? 'clickable' : ''} ${isActive ? 'active' : ''}`}
                    onClick=${clickable ? () => setActiveRating(r => r === ratingValue ? null : ratingValue) : undefined}
                  >
                    <span>${row.label}★</span>
                    <div class="distribution-track"><div class=${`distribution-fill ${clickable ? `fill-tier-${ratingTier(ratingValue)}` : ''}`} style=${{ width: row.percent }}></div></div>
                    <span>${row.percent}</span>
                  <//>
                `;
              })}
            </div>
          `}
          ${state.context.keywords.length > 0 && html`
            <div class="context-section-title" data-badge="format_quote">Keywords from Reviews</div>
            <div class="keyword-row">
              ${state.context.keywords.map(keyword => html`
                <button
                  type="button"
                  class=${`keyword-chip ${activeKeyword === keyword ? 'active' : ''}`}
                  onClick=${() => setActiveKeyword(k => k === keyword ? null : keyword)}
                >${keyword}</button>
              `)}
            </div>
          `}
        `}
        ${state.reviews.length === 0 ? html`
          <p class="muted">No global reviews found. <a href="#" onClick=${(e) => { e.preventDefault(); cache.refresh(); }}>Refresh</a></p>
        ` : html`
          <p class="muted">
            ${hasActiveFilter
              ? `Showing ${filteredReviews.length} of ${state.reviews.length} loaded reviews${activeKeyword ? ` mentioning “${activeKeyword}”` : ''}${activeRating ? `${activeKeyword ? ' and' : ''} rated ${activeRating}★` : ''}. `
              : `Showing ${state.reviews.length} popular global review${state.reviews.length === 1 ? '' : 's'}. `}
            ${hasActiveFilter && html`<a href="#" onClick=${(e) => { e.preventDefault(); clearFilters(); }}>Clear</a>${' · '}`}
            <a href="#" onClick=${(e) => { e.preventDefault(); cache.refresh(); }}>Refresh</a>
          </p>
          ${filteredReviews.length === 0 ? html`
            <p class="muted">None of the loaded reviews match this filter — the distribution/keyword cloud may be drawn from more reviews than this page loaded.</p>
          ` : html`
            <div class="review-list">
              ${filteredReviews.map(review => html`
                <article class="review-item">
                  <div class="review-meta">
                    ${review.rating && html`<span class=${`style-chip-rating tier-${ratingTier(Number(review.rating))}`}>${review.rating}/5</span>`}
                    ${review.date && html`<span>${review.date}</span>`}
                  </div>
                  <p class="review-text">${highlightKeyword(review.review, activeKeyword)}</p>
                </article>
              `)}
            </div>
          `}
        `}
        <${SiteModalLink} href=${url} title="Global reviews" className="small-link">All Global Reviews →<//>
      `}
    </div>
  `;
}

export function TracksPreview({ album, projectName }) {
  const favorites = useFavoriteTracks(projectName);
  const musicService = useMusicService();
  const players = useEmbeddablePlayers();
  const state = useAlbumTrackMetadata(album);
  const [activeEmbedTrackId, setActiveEmbedTrackId] = useState(null);

  useEffect(() => {
    if (!state.data) return;
    state.data.tracks.forEach((track) => { if (favoriteTrackId(track)) favorites.sync(track); });
  }, [state.data]);

  return html`
    <div>
      ${favorites.errorMessage && html`<p class="muted">${favorites.errorMessage}</p>`}
      ${state.status === 'hidden' && html`<p class="muted">No track metadata is available for this album.</p>`}
      ${state.status === 'error' && html`<p class="muted">Couldn't load track metadata. <a href="#" onClick=${(e) => { e.preventDefault(); state.refresh(); }}>Refresh</a></p>`}
      ${state.status === 'ready' && state.data && html`
        ${state.data.album && html`
          <div class="context-grid" style=${{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <div class="context-stat"><div class="value">${state.data.album.trackCount != null ? state.data.album.trackCount : state.data.tracks.length}</div><div class="label">Tracks</div></div>
            <div class="context-stat"><div class="value">${formatDurationMs(state.data.album.totalRuntimeMs)}</div><div class="label">Runtime</div></div>
          </div>
          ${state.data.album.copyright && html`<p class="label-caption" title=${state.data.album.copyright}>${state.data.album.copyright}</p>`}
          ${state.data.album.trackCount != null && state.data.album.trackCount !== state.data.tracks.length && html`
            <p class="muted">Track data returned ${state.data.tracks.length} rows for an album marked as ${state.data.album.trackCount} tracks.</p>
          `}
        `}
        <p class="muted"><a href="#" onClick=${(e) => { e.preventDefault(); state.refresh(); }}>Refresh</a></p>
        ${state.data.tracks.length === 0 ? html`
          <p class="muted">No track rows were returned. <a href="#" onClick=${(e) => { e.preventDefault(); state.refresh(); }}>Refresh</a></p>
        ` : html`
          <div class="table-scroll">
            <table class="tracks-table">
              <thead><tr><th></th><th></th><th>#</th><th>Track</th><th>Length</th></tr></thead>
              <tbody>
                ${state.data.tracks.map(track => {
                  const trackId = favoriteTrackId(track);
                  const favorited = trackId && favorites.isFavorite(trackId);
                  const embed = players.enabled ? trackEmbed(track, musicService.preference) : null;
                  const embedOpen = trackId && activeEmbedTrackId === trackId;
                  const trackUrl = embed?.openUrl || track.trackViewUrl;
                  return html`
                    <${Fragment}>
                      <tr>
                        <td>
                          ${trackId && html`
                            <button
                              type="button"
                              class=${`star-btn ${favorited ? 'active' : ''}`}
                              aria-label=${favorited ? 'Unfavorite track' : 'Favorite track'}
                              onClick=${() => favorites.toggle(track)}
                            >${favorited ? '★' : '☆'}</button>
                          `}
                        </td>
                        <td>
                          ${embed && trackId && html`
                            <button
                              type="button"
                              class=${`embed-btn ${embedOpen ? 'active' : ''}`}
                              aria-label=${embedOpen ? 'Hide track player' : `Play preview with ${embed.service}`}
                              title=${embedOpen ? 'Hide player' : `Play with ${embed.service}`}
                              onClick=${() => setActiveEmbedTrackId(current => current === trackId ? null : trackId)}
                            ><span class="icon-symbol">${embedOpen ? 'expand_less' : 'play_arrow'}</span></button>
                          `}
                        </td>
                        <td>${track.discNumber > 1 ? `${track.discNumber}-${track.trackNumber}` : track.trackNumber}</td>
                        <td class="truncate-cell" title=${track.title}>${trackUrl
                          ? html`<a href=${trackUrl} target="_blank" rel="noopener" class="track-link">${track.title}</a>`
                          : track.title}</td>
                        <td>${formatDurationMs(track.durationMs)}</td>
                      </tr>
                      ${embedOpen && html`
                        <tr class="track-embed-row">
                          <td colspan="5">
                            <div class="track-embed-label">
                              <span>${embed.service}</span>
                              <a href=${embed.openUrl} target="_blank" rel="noopener">Open track</a>
                            </div>
                            <iframe
                              class="track-embed-frame"
                              src=${embed.url}
                              title=${`${track.title} on ${embed.service}`}
                              loading="lazy"
                              allow="autoplay *; clipboard-write *; encrypted-media *; fullscreen *; picture-in-picture *"
                            ></iframe>
                          </td>
                        </tr>
                      `}
                    <//>
                `;
                })}
              </tbody>
            </table>
          </div>
        `}
      `}
    </div>
  `;
}

export function GroupReviewsPreview({ groupSlug, album, initialReviews = null }) {
  const [state, setState] = useState(() => initialReviews
    ? { status: 'ready', reviews: initialReviews, errorMessage: '' }
    : { status: 'loading', reviews: [], errorMessage: '' });

  useEffect(() => {
    if (initialReviews) {
      setState({ status: 'ready', reviews: initialReviews, errorMessage: '' });
      return;
    }
    if (!groupSlug || !album || !album.uuid) return;
    let cancelled = false;
    setState({ status: 'loading', reviews: [], errorMessage: '' });
    fetchGroupAlbumReviews(groupSlug, album.uuid)
      .then((data) => {
        const reviews = (data.reviews || []).filter(r => r.rating != null || r.review);
        if (!cancelled) setState({ status: 'ready', reviews, errorMessage: '' });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', reviews: [], errorMessage: error.message || "Couldn't load group reviews." });
      });
    return () => { cancelled = true; };
  }, [groupSlug, album && album.uuid, initialReviews]);

  return html`
    <div>
      ${state.status === 'error' && html`<p class="muted">${state.errorMessage}</p>`}
      ${state.status === 'ready' && html`
        ${state.reviews.length === 0 ? html`
          <p class="muted">No one in the group has rated this album yet.</p>
        ` : html`
          <div class="review-list review-list--unbounded">
            ${state.reviews.map(review => html`
              <article class="review-item">
                <div class="review-meta">
                  <span>${review.projectName}</span>
                  ${review.rating != null
                    ? html`<span class=${review.rating === 'did-not-listen' ? 'muted' : `style-chip-rating tier-${ratingTier(review.rating)}`}>${review.rating === 'did-not-listen' ? 'Did not listen' : `${review.rating}/5`}</span>`
                    : html`<span class="muted">Not yet rated</span>`}
                </div>
                ${review.review ? html`<p class="review-text">${review.review}</p>` : html`<p class="review-text muted">No written review.</p>`}
              </article>
            `)}
          </div>
        `}
      `}
    </div>
  `;
}

export function AlbumInfoTabs({ album, projectName = null, groupSlug = null, comparison = null, tab = 'summary', onTabChange, summarySections = null, reviewKeyword = '', groupReviews = null }) {
  const hasGroupReviews = !!(groupSlug && album && album.uuid);

  return html`
    <div class="album-panel">
      <div class="album-panel-tabs">
        <button type="button" class=${`album-panel-tab ${tab === 'summary' ? 'active' : ''}`} onClick=${() => onTabChange('summary')}>Summary</button>
        <button type="button" class=${`album-panel-tab ${tab === 'tracks' ? 'active' : ''}`} onClick=${() => onTabChange('tracks')}>Tracks</button>
        ${album.globalReviewsUrl && html`
        <button type="button" class=${`album-panel-tab ${tab === 'reviews' ? 'active' : ''}`} onClick=${() => onTabChange('reviews')}>Global Reviews</button>
        `}
        ${hasGroupReviews && html`
        <button type="button" class=${`album-panel-tab ${tab === 'group' ? 'active' : ''}`} onClick=${() => onTabChange('group')}>Group Reviews</button>
        `}
      </div>
      ${tab === 'summary' && html`
        ${album.wikipediaUrl && html`<${WikipediaSummary} url=${album.wikipediaUrl} />`}
        <${AlbumSummaryContext} album=${album} projectName=${projectName} comparison=${comparison} sections=${summarySections} />
      `}
      ${tab === 'tracks' && html`<${TracksPreview} album=${album} projectName=${projectName} />`}
      ${tab === 'reviews' && album.globalReviewsUrl && html`<${GlobalReviewsPreview} url=${album.globalReviewsUrl} initialKeyword=${reviewKeyword} />`}
      ${tab === 'group' && hasGroupReviews && html`<${GroupReviewsPreview} groupSlug=${groupSlug} album=${album} initialReviews=${groupReviews} />`}
    </div>
  `;
}
