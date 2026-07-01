import { h } from 'preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import htm from 'htm';
import { ALBUM_CATALOG_TTL_MS, DIDDY_GIF_URL } from '../lib/constants.js';
import { readAlbumCatalog, writeAlbumCatalog } from '../lib/cache.js';
import { fetchAlbumCatalog, fetchAlbumTrackRecord, searchAlbumsByWord } from '../lib/api.js';
import { formatCacheAge } from '../lib/format.js';
import { useRecommendations } from '../lib/hub.js';
import {
  navigateSubTab, navigateForward, navigateTo, navigateBack, discoverModeRoutePath,
  discoverAlbumRoutePath, readLastDiscoverPath, writeLastDiscoverPath,
} from '../lib/routing.js';
import { useAlbumPlayer, AlbumPlayButton } from './player.js';
import { StreamingLinks, LoadingNote } from './common.js';
import { AlbumInfoTabs, AlbumSummaryContext } from './album.js';

const html = htm.bind(h);

// ---------- nav ----------
export function useAlbumCatalog(source = 'global') {
  const [state, setState] = useState(() => {
    const cached = readAlbumCatalog(source);
    return cached
      ? { status: 'ready', albums: cached.albums, fetchedAt: cached.fetchedAt }
      : { status: 'idle', albums: [], fetchedAt: null };
  });
  const load = useCallback((force = false) => {
    if (!force) {
      const cached = readAlbumCatalog(source);
      if (cached && Date.now() - cached.fetchedAt < ALBUM_CATALOG_TTL_MS) {
        setState({ status: 'ready', albums: cached.albums, fetchedAt: cached.fetchedAt });
        return;
      }
    }
    setState(s => ({ ...s, status: 'loading' }));
    fetchAlbumCatalog(source)
      .then(albums => {
        writeAlbumCatalog(source, albums);
        setState({ status: 'ready', albums, fetchedAt: Date.now() });
      })
      .catch(err => setState(s => ({ ...s, status: 'error', error: err.message })));
  }, [source]);
  return { ...state, load };
}

export function useAlbumThumbs() {
  const catalog = useAlbumCatalog('global');
  useEffect(() => { catalog.load(); }, [catalog.load]);
  return useMemo(() => {
    const map = new Map();
    for (const a of catalog.albums) if (a.spotifyId && a.images?.[0]) map.set(a.spotifyId, a.images[0].url);
    return map;
  }, [catalog.albums]);
}

export function useEditorState(initialNotes, resetKey) {
  const [notes, setNotes] = useState(initialNotes || '');
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  useEffect(() => { setNotes(initialNotes || ''); setStatus('idle'); setErrorMessage(''); }, [resetKey, initialNotes]);
  return { notes, setNotes, status, setStatus, errorMessage, setErrorMessage };
}

export function ExploreAlbumRow({ album, mentionCount, onClick, tags, selectedTags, onTagClick }) {
  const thumb = album.images && album.images[0];
  const selectedSet = selectedTags ? new Set(selectedTags.map(normalizeExploreTag)) : null;
  return html`
    <button class="explore-album-row" type="button" onClick=${(e) => { if (e.target.closest('.explore-album-tag.clickable')) return; onClick(album); }} role="listitem">
      ${thumb
        ? html`<img class="explore-album-thumb" src=${thumb.url} alt="" loading="lazy" decoding="async" />`
        : html`<div class="explore-album-thumb"></div>`
      }
      <div class="explore-album-info">
        <div class="explore-album-name">${album.name}</div>
        <div class="explore-album-artist">${album.artist}</div>
        <div class="explore-album-meta">
          ${mentionCount != null
            ? html`<span class="explore-mention-count">${mentionCount} mention${mentionCount !== 1 ? 's' : ''} in reviews</span>`
            : (album.votes ? html`${album.averageRating?.toFixed(2)} ★ | ${album.votes.toLocaleString()} votes` : '')
          }
        </div>
        ${tags && tags.length > 0 && html`
          <div class="explore-album-tags">
            ${tags.map(tag => {
              const label = formatExploreTag(tag);
              const isSelected = selectedSet?.has(normalizeExploreTag(label));
              return isSelected || !onTagClick
                ? html`<span class=${`explore-album-tag${isSelected ? ' selected' : ''}`}>${label}</span>`
                : html`<span class="explore-album-tag clickable" role="button" tabIndex="0" onClick=${() => onTagClick(label)} onKeyDown=${(e) => (e.key === 'Enter' || e.key === ' ') && onTagClick(label)} title=${`Add "${label}" filter`}>${label}</span>`;
            })}
          </div>
        `}
      </div>
    </button>
  `;
}

export function normalizeExploreTag(value) {
  return String(value || '').trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

export function formatExploreTag(value) {
  return String(value || '').replace(/-/g, ' ');
}

export function buildGenreStyleIndex(albums) {
  const byTag = new Map();
  for (const album of albums || []) {
    for (const type of ['genres', 'styles']) {
      for (const tag of album[type] || []) {
        const key = normalizeExploreTag(tag);
        if (!key) continue;
        const current = byTag.get(key) || { tag, albums: [] };
        current.albums.push(album);
        byTag.set(key, current);
        byTag.set(normalizeExploreTag(formatExploreTag(tag)), current);
      }
    }
  }

  const options = [...byTag.values()]
    .map(({ tag, albums }) => ({ tag, label: formatExploreTag(tag), count: albums.length }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return { byTag, options };
}

export function searchAlbumsByGenreStyle(albums, index, query) {
  const normalized = normalizeExploreTag(query);
  if (!normalized) return { label: '', albums: [] };

  const exact = index.byTag.get(normalized);
  if (exact) {
    return {
      label: formatExploreTag(exact.tag),
      albums: [...exact.albums].sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0) || (b.votes || 0) - (a.votes || 0)),
    };
  }

  const matches = (albums || []).filter(album => {
    const tags = [...(album.genres || []), ...(album.styles || [])];
    return tags.some(tag => normalizeExploreTag(tag).includes(normalized));
  });
  return {
    label: query.trim(),
    albums: matches.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0) || (b.votes || 0) - (a.votes || 0)),
  };
}

export function findSimilarTagSet(album, catalogAlbums, genreStyleIndex, minResults = 5) {
  const allTags = [...(album.genres || []), ...(album.styles || [])];
  if (!allTags.length || !catalogAlbums.length) return null;
  const ranked = allTags
    .map(tag => ({
      tag, label: formatExploreTag(tag),
      normalized: normalizeExploreTag(tag),
      count: genreStyleIndex.byTag.get(normalizeExploreTag(tag))?.albums.length || 0,
    }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count);
  if (!ranked.length) return null;
  for (let n = ranked.length; n >= 1; n--) {
    const subset = ranked.slice(0, n);
    let albums = [...catalogAlbums];
    for (const { normalized } of subset) {
      albums = albums.filter(a =>
        [...(a.genres || []), ...(a.styles || [])].some(t => normalizeExploreTag(t).includes(normalized))
      );
    }
    const count = albums.filter(a => a.slug !== album.slug).length;
    if (count >= minResults) return { tags: subset.map(t => t.label), count };
  }
  return null;
}

export function SimilarAlbumsHelper({ album, projectName, source = 'global' }) {
  const { enabled: diddyEnabled } = useRecommendations();
  const albumPlayer = useAlbumPlayer();
  const catalog = useAlbumCatalog(source);
  useEffect(() => { catalog.load(); }, [catalog.load]);
  const genreStyleIndex = useMemo(() => buildGenreStyleIndex(catalog.albums), [catalog.albums]);
  const catalogAlbum = useMemo(() =>
    catalog.albums.find(a =>
      (album.spotifyId && a.spotifyId === album.spotifyId) ||
      (album.slug && a.slug === album.slug)
    ) || album,
  [catalog.albums, album]);
  const result = useMemo(
    () => findSimilarTagSet(catalogAlbum, catalog.albums, genreStyleIndex),
    [catalogAlbum, catalog.albums, genreStyleIndex]
  );

  const [dismissed, setDismissed] = useState(false);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const resultKey = result ? result.tags.join(',') : '';
  useEffect(() => { setDismissed(false); setBubbleOpen(false); }, [resultKey]);

  const DIDDY_LINES = [
    "Yo, these joints bump the same vibe! 🎵",
    "Word! These tracks are straight PHAT! 🔥",
    "No doubt — these albums are ALL THAT! 💿",
    "Booyah! Found joints that hit the same! 🎶",
    "These are da BOMB, straight up! 💣",
    "Psych! You're gonna LOVE these! 🤙",
    "For real tho, these joints are BANGIN'! 🥁",
    "Awww yeah, same energy all day! ✌️",
    "Fly finds ahead, mad real! 🎤",
    "These albums are wicked fresh, no doubt! 🕶️",
    "OOH BABY BABY, your ears need this! 👂",
    "Got some PHAT joints with your name on 'em! 📛",
    "Aight aight aight — check these out! 👀",
    "Straight FIRE in the same lane, fam! 🔥",
    "Don't sleep on these! They're all that and a bag of chips! 🛍️",
    "Mmm-MMM! These albums hit different! 💥",
    "Ayo, same frequency, different antenna! 📡",
    "Real talk — these joints are certified 🔥",
    "Uh-huh, uh-huh, uh-huh! Same vibe detected! 🎯",
    "Wanna take it there? These albums WILL! 🚀",
    "Keepin' it real — these are your people! 🤝",
    "No cap, these albums straight slap! 🫡",
    "Oooooh wee! Your next obsession awaits! 😤",
    "Comin' atcha with some certified heat! ☀️",
    "Boom shakalaka — same energy incoming! 💫",
  ];
  const DIDDY_LINK_LINES = [
    (n) => `${n} similar albums →`,
    (n) => `Peep ${n} joints like this →`,
    (n) => `Check ${n} albums in the same lane →`,
    (n) => `${n} albums that hit the same →`,
    (n) => `Vibe with ${n} more like this →`,
    (n) => `Explore ${n} kindred albums →`,
    (n) => `${n} records with the same energy →`,
    (n) => `Find ${n} albums on the same tip →`,
    (n) => `${n} more bangers in this zone →`,
    (n) => `Slide into ${n} similar joints →`,
  ];
  const [headline] = useState(() => DIDDY_LINES[Math.floor(Math.random() * DIDDY_LINES.length)]);
  const [linkFn] = useState(() => DIDDY_LINK_LINES[Math.floor(Math.random() * DIDDY_LINK_LINES.length)]);

  if (albumPlayer.player || !diddyEnabled || !result || catalog.status !== 'ready' || dismissed) return null;

  const href = discoverModeRoutePath(projectName, source, 'genre-style', result.tags.join(','));

  return createPortal(html`
    <div class="diddy-float">
      ${bubbleOpen && html`
        <div class="diddy-bubble">
          <div class="diddy-bubble-headline">${headline}</div>
          <a class="diddy-bubble-link" href=${href} onClick=${(e) => { e.preventDefault(); navigateForward(href); }}>
            ${linkFn(result.count)}
          </a>
          <button class="diddy-bubble-close" onClick=${() => setDismissed(true)}>✕</button>
        </div>
      `}
      <button class="diddy-char-btn" onClick=${() => setBubbleOpen(o => !o)} aria-label="Similar albums">
        <img class="diddy-char-img" src=${DIDDY_GIF_URL} alt="" aria-hidden="true" />
      </button>
    </div>
  `, document.body);
}

export function useDiscoverAlbum(albumSlug, source, hubData) {
  const catalog = useAlbumCatalog(source);
  useEffect(() => { catalog.load(); }, [catalog.load]);
  const catalogAlbum = useMemo(() => catalog.albums.find(a => a.slug === albumSlug), [catalog.albums, albumSlug]);

  // fetchAlbumTrackRecord already dedupes/caches per spotifyId for the life of the page (see its
  // own Map in lib/api.js), and the KV it reads from is our own — same-origin, fast, not the kind
  // of external/rate-limited fetch useCachedFetch's localStorage-forever caching exists to
  // insulate against (compare useAlbumTrackMetadata in components/album.js, which fetches the
  // same record with no localStorage layer either). The KV enrichment record's wikipedia/
  // apple-music IDs live under `services`, not `album` — see parseStoredTrackAlbum, which reads
  // the same shape correctly.
  const [enrichmentServices, setEnrichmentServices] = useState(null);
  useEffect(() => {
    setEnrichmentServices(null);
    if (!catalogAlbum?.spotifyId) return;
    let cancelled = false;
    fetchAlbumTrackRecord(catalogAlbum.spotifyId)
      .then((record) => { if (!cancelled) setEnrichmentServices(record?.services ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [catalogAlbum?.spotifyId]);

  const album = useMemo(() => {
    if (!catalogAlbum) return null;
    let base = { ...catalogAlbum };
    // Merge hub history data (authoritative for streaming IDs)
    if (hubData) {
      for (const project of Object.values(hubData.members || {})) {
        if (!project || project.__error) continue;
        for (const entry of project.history || []) {
          if (entry.album?.spotifyId === catalogAlbum.spotifyId) { base = { ...base, ...entry.album }; break; }
        }
      }
    }
    if (!base.wikipediaUrl && enrichmentServices?.wikipedia?.url) {
      base.wikipediaUrl = enrichmentServices.wikipedia.url;
    }
    if (!base.appleMusicId && enrichmentServices?.appleMusic?.albumId) {
      base.appleMusicId = enrichmentServices.appleMusic.albumId;
    }
    return base;
  }, [catalogAlbum, hubData, enrichmentServices]);

  return { album, scrapedContext: null, catalogStatus: catalog.status };
}

export function DiscoverAlbumView({ albumSlug, projectName, source = 'global', hubData = null, initialTab = 'summary', reviewKeyword = '' }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => { setTab(initialTab); }, [albumSlug, initialTab]);
  const setDiscoverTab = (nextTab) => {
    navigateSubTab(discoverAlbumRoutePath(
      projectName,
      albumSlug,
      source,
      nextTab,
      nextTab === 'reviews' ? reviewKeyword : ''
    ));
  };
  const { album, scrapedContext, catalogStatus } = useDiscoverAlbum(albumSlug, source, hubData);

  if (catalogStatus === 'loading' && !album) return html`<${LoadingNote} label="Loading…" />`;
  if (!album) return html`<div class="card"><p class="muted">Album not found.</p></div>`;

  const thumb = album.images?.[0];
  return html`
    <div>
      <div class="banner te-banner">
        <strong>Album Details</strong>
        <span class="spacer"></span>
        <a class="pill-btn primary" href=${readLastDiscoverPath(projectName)} onClick=${(e) => { e.preventDefault(); navigateBack(readLastDiscoverPath(projectName)); }}>← Back to Explore</a>
      </div>
      <div class="card te-panel">
        <div class="today-layout">
          <div class="today-primary">
            ${thumb && html`<img class="album-art" src=${thumb.url} alt=${album.name} loading="lazy" decoding="async" />`}
            <div class="album-header-row">
              <div class="album-header-text">
                <p class="album-title">${album.name}</p>
                <p class="album-artist">${album.artist}${album.releaseDate ? ` (${album.releaseDate})` : ''}</p>
              </div>
              <${AlbumPlayButton} album=${album} />
              <${StreamingLinks} album=${album} extraLinks=${scrapedContext?.streamingLinks || []} />
            </div>
            <${AlbumSummaryContext} album=${album} projectName=${projectName} discoverSource=${source} sections=${['genres', 'discovery']} />
            <${SimilarAlbumsHelper} album=${album} projectName=${projectName} source=${source} />
          </div>
          <div class="today-secondary">
            <${AlbumInfoTabs} album=${album} projectName=${projectName} tab=${tab} onTabChange=${setDiscoverTab} summarySections=${['rating']} reviewKeyword=${reviewKeyword} />
          </div>
        </div>
      </div>
    </div>
  `;
}

export function ExploreView({ projectName, source = 'global', mode = 'browse', initialQuery = '' }) {
  const catalog = useAlbumCatalog(source);
  const keywordEnabled = source !== 'user';
  const [query, setQuery] = useState('');
  const [kwQuery, setKwQuery] = useState(mode === 'keyword' ? initialQuery : '');
  const [kwResults, setKwResults] = useState(null);
  const [kwStatus, setKwStatus] = useState(mode === 'keyword' && initialQuery ? 'loading' : 'idle');
  const [kwError, setKwError] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState(() =>
    mode === 'genre-style' && initialQuery ? initialQuery.split(',').map(t => t.trim()).filter(Boolean) : []
  );
  const [tagSuggestActive, setTagSuggestActive] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { catalog.load(); }, [catalog.load]);

  useEffect(() => {
    if (source === 'user' && mode === 'keyword') {
      navigateSubTab(discoverModeRoutePath(projectName, source, 'browse'));
    }
  }, [projectName, source, mode]);

  useEffect(() => {
    writeLastDiscoverPath(projectName, discoverModeRoutePath(projectName, source, mode, initialQuery));
  }, [projectName, source, mode, initialQuery]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(t);
  }, [mode, source]);

  const browseAlbums = useMemo(() => {
    if (!catalog.albums.length) return [];
    const sorted = [...catalog.albums].sort((a, b) => b.votes - a.votes);
    if (!query.trim()) return sorted.slice(0, 50);
    const q = query.toLowerCase();
    return sorted.filter(a => a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q));
  }, [catalog.albums, query]);

  const catalogBySpotifyId = useMemo(() => {
    const map = {};
    for (const a of catalog.albums) {
      if (a.spotifyId) map[a.spotifyId] = a;
      if (a.originalSpotifyId) map[a.originalSpotifyId] = a;
    }
    return map;
  }, [catalog.albums]);

  const genreStyleIndex = useMemo(() => buildGenreStyleIndex(catalog.albums), [catalog.albums]);

  const tagResults = useMemo(() => {
    if (!selectedTags.length || !catalog.albums.length) return null;
    let albums = [...catalog.albums];
    for (const tag of selectedTags) {
      const normalized = normalizeExploreTag(tag);
      albums = albums.filter(album =>
        [...(album.genres || []), ...(album.styles || [])].some(t => normalizeExploreTag(t).includes(normalized))
      );
    }
    return albums.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0) || (b.votes || 0) - (a.votes || 0));
  }, [selectedTags, catalog.albums]);

  const activeGenreStyleIndex = useMemo(() =>
    tagResults ? buildGenreStyleIndex(tagResults) : genreStyleIndex,
  [tagResults, genreStyleIndex]);

  const tagSuggestions = useMemo(() => {
    const q = normalizeExploreTag(tagQuery);
    if (!q) return [];
    const selected = new Set(selectedTags.map(normalizeExploreTag));
    return activeGenreStyleIndex.options
      .filter(option => normalizeExploreTag(option.label).includes(q) && !selected.has(normalizeExploreTag(option.label)))
      .slice(0, 8);
  }, [activeGenreStyleIndex, tagQuery, selectedTags]);

  useEffect(() => {
    if (mode !== 'keyword' || !keywordEnabled) return;
    setKwQuery(initialQuery || '');
    setKwResults(null);
    setKwError('');
    if (!initialQuery) { setKwStatus('idle'); return; }
    let cancelled = false;
    setKwStatus('loading');
    searchAlbumsByWord(initialQuery)
      .then(results => {
        if (!cancelled) {
          setKwResults(results);
          setKwStatus('ready');
        }
      })
      .catch(err => {
        if (!cancelled) {
          setKwError(err.message);
          setKwStatus('error');
        }
      });
    return () => { cancelled = true; };
  }, [mode, initialQuery, keywordEnabled]);

  useEffect(() => {
    if (mode !== 'genre-style') return;
    setTagQuery('');
    setTagSuggestActive(false);
    setSelectedTags(initialQuery ? initialQuery.split(',').map(t => t.trim()).filter(Boolean) : []);
  }, [mode, initialQuery]);

  const handleAlbumClick = (album) => {
    writeLastDiscoverPath(projectName, discoverModeRoutePath(projectName, source, mode, mode === 'keyword' ? kwQuery : (mode === 'genre-style' ? selectedTags.join(',') : '')));
    if (mode === 'keyword' && kwQuery.trim()) {
      navigateForward(discoverAlbumRoutePath(projectName, album.slug, source, 'reviews', kwQuery));
      return;
    }
    navigateForward(discoverAlbumRoutePath(projectName, album.slug, source));
  };

  const handleKwSearch = async (e) => {
    e.preventDefault();
    if (!kwQuery.trim()) return;
    navigateSubTab(discoverModeRoutePath(projectName, source, 'keyword', kwQuery));
  };

  const addTag = (query) => {
    const normalized = normalizeExploreTag(query);
    if (!normalized) return;
    if (selectedTags.some(t => normalizeExploreTag(t) === normalized)) return;
    const exact = genreStyleIndex.byTag.get(normalized);
    const label = exact ? formatExploreTag(exact.tag) : query.trim();
    const newTags = [...selectedTags, label];
    setTagQuery('');
    setTagSuggestActive(false);
    navigateTo(discoverModeRoutePath(projectName, source, 'genre-style', newTags.join(',')));
  };

  const removeTag = (tag) => {
    const newTags = selectedTags.filter(t => t !== tag);
    navigateTo(discoverModeRoutePath(projectName, source, 'genre-style', newTags.join(',')));
  };

  const handleGenreStyleSearch = (e) => {
    e.preventDefault();
    addTag(tagQuery);
  };

  const selectGenreStyleSuggestion = (label) => {
    addTag(label);
  };

  const cacheAge = catalog.fetchedAt ? formatCacheAge(catalog.fetchedAt) : null;
  const showTagSuggestions = tagSuggestActive && tagQuery.trim() && tagSuggestions.length > 0;
  const toggledSource = source === 'global' ? 'user' : 'global';

  return html`
    <div class="card" style=${{ padding: 0 }}>
      <div class="modal-header" style=${{ borderRadius: 'var(--radius) var(--radius) 0 0' }}>
        <div class="modal-title">Explore Albums</div>
        <div class="explore-mode-toggle">
          <button class=${`explore-mode-btn ${mode === 'browse' ? 'active' : ''}`} type="button" onClick=${() => navigateSubTab(discoverModeRoutePath(projectName, source, 'browse'))}>Browse</button>
          ${keywordEnabled && html`<button class=${`explore-mode-btn ${mode === 'keyword' ? 'active' : ''}`} type="button" onClick=${() => navigateSubTab(discoverModeRoutePath(projectName, source, 'keyword'))}>Keyword</button>`}
          <button class=${`explore-mode-btn ${mode === 'genre-style' ? 'active' : ''}`} type="button" onClick=${() => navigateSubTab(discoverModeRoutePath(projectName, source, 'genre-style'))}>Genres</button>
        </div>
      </div>

      ${mode === 'browse' && html`
        <div class="explore-controls">
          <div class="explore-search-row">
            <div class="explore-field">
              <button class="explore-source-chip" type="button" onClick=${() => navigateSubTab(discoverModeRoutePath(projectName, toggledSource, 'browse'))}>
                <span style=${`color:${source === 'global' ? 'var(--accent)' : 'var(--text-dim)'}`}>Global</span><span style="color:var(--text-dim)">|</span><span style=${`color:${source === 'user' ? 'var(--accent)' : 'var(--text-dim)'}`}>User</span>
              </button>
              <input
                ref=${inputRef}
                class="explore-input"
                type="search"
                placeholder="Filter by album or artist…"
                value=${query}
                onInput=${e => setQuery(e.target.value)}
                aria-label="Filter albums"
              />
              <button
                class="explore-field-submit"
                type="button"
                title=${cacheAge ? `${source === 'user' ? 'User albums' : 'Global catalog'} cached ${cacheAge} — click to refresh` : 'Refresh catalog'}
                aria-label="Force refresh album catalog"
                onClick=${() => catalog.load(true)}
                disabled=${catalog.status === 'loading'}
              >
                <span class="icon-symbol">refresh</span>
              </button>
            </div>
          </div>
          ${cacheAge && html`<div class="explore-cache-note">${source === 'user' ? 'User albums' : 'Global catalog'} cached ${cacheAge}</div>`}
        </div>
        <div class="explore-results" role="list">
          ${catalog.status === 'loading' && html`<${LoadingNote} label="Loading album catalog…" />`}
          ${catalog.status === 'error' && html`<p class="muted" style=${{ padding: '16px' }}>Failed to load. <button class="link-chip" type="button" onClick=${() => catalog.load(true)}>Retry</button></p>`}
          ${catalog.status === 'ready' && html`
            ${!query.trim() && html`<p class="explore-hint">Showing ${browseAlbums.length} most-voted ${source === 'user' ? 'user albums' : 'albums'} — search to filter all 1001</p>`}
            ${query.trim() && !browseAlbums.length && html`<p class="muted" style=${{ padding: '16px' }}>No albums match "${query}"</p>`}
            ${browseAlbums.map(album => html`<${ExploreAlbumRow} key=${album.spotifyId || album.slug} album=${album} onClick=${handleAlbumClick} />`)}
          `}
        </div>
      `}

      ${mode === 'keyword' && html`
        <div class="explore-controls">
          ${keywordEnabled
            ? html`
              <form class="explore-search-row" onSubmit=${handleKwSearch}>
                <div class="explore-field">
                  <button class="explore-source-chip" type="button" disabled>
                    <span style="color:var(--accent)">Global</span><span style="color:var(--text-dim)">|</span><span style="color:var(--text-dim)">User</span>
                  </button>
                  <input
                    ref=${inputRef}
                    class="explore-input"
                    type="search"
                    placeholder="e.g. melancholy, psychedelic, masterpiece…"
                    value=${kwQuery}
                    onInput=${e => setKwQuery(e.target.value)}
                    aria-label="Search reviews for keyword"
                  />
                  <button class="explore-field-submit" type="submit" disabled=${kwStatus === 'loading' || !kwQuery.trim()}>
                    <span class="icon-symbol">search</span>
                  </button>
                </div>
              </form>
            `
            : html`
              <p class="muted" style=${{ padding: '16px' }}>Keyword search is only available for the global album catalog.</p>
              <div class="explore-cache-note">Switch to Global to search review text.</div>
            `
          }
        </div>
        <div class="explore-results" role="list">
          ${keywordEnabled && html`
            ${kwStatus === 'idle' && html`<p class="explore-hint">Find albums by what reviewers say about them</p>`}
            ${kwStatus === 'loading' && html`<${LoadingNote} label="Searching reviews…" />`}
            ${kwStatus === 'error' && html`<p class="muted" style=${{ padding: '16px' }}>${kwError}</p>`}
            ${kwStatus === 'ready' && !kwResults?.length && html`<p class="muted" style=${{ padding: '16px' }}>No results for "${kwQuery}"</p>`}
            ${kwStatus === 'ready' && kwResults?.map(r => {
              const catalogAlbum = catalogBySpotifyId[r.albumId];
              const album = catalogAlbum || { name: r.albumName, artist: r.artistName, slug: r.albumSlug, spotifyId: r.albumId };
              return html`<${ExploreAlbumRow} key=${r.albumId} album=${album} mentionCount=${r.wordCount} onClick=${handleAlbumClick} />`;
            })}
          `}
        </div>
      `}

      ${mode === 'genre-style' && html`
        <div class="explore-controls">
          <form class="explore-search-row" onSubmit=${handleGenreStyleSearch}>
            <div class="explore-field">
              <button class="explore-source-chip" type="button" onClick=${() => navigateSubTab(discoverModeRoutePath(projectName, toggledSource, 'genre-style', selectedTags.join(',')))}>
                <span style=${`color:${source === 'global' ? 'var(--accent)' : 'var(--text-dim)'}`}>Global</span><span style="color:var(--text-dim)">|</span><span style=${`color:${source === 'user' ? 'var(--accent)' : 'var(--text-dim)'}`}>User</span>
              </button>
              <div class="explore-suggest-wrap">
                <input
                  ref=${inputRef}
                  class="explore-input"
                  type="search"
                  placeholder="e.g. psychedelic rock, soul, hip hop…"
                  value=${tagQuery}
                  onInput=${e => { setTagQuery(e.target.value); setTagSuggestActive(true); }}
                  onFocus=${() => setTagSuggestActive(false)}
                  onBlur=${() => setTimeout(() => setTagSuggestActive(false), 120)}
                  aria-label="Search genres and styles"
                  aria-autocomplete="list"
                  aria-expanded=${showTagSuggestions}
                />
                ${showTagSuggestions && html`
                  <div class="explore-suggestions" role="listbox">
                    ${tagSuggestions.map(option => html`
                      <button
                        type="button"
                        class="explore-suggestion"
                        role="option"
                        onMouseDown=${e => e.preventDefault()}
                        onClick=${() => selectGenreStyleSuggestion(option.label)}
                      >
                        <span>${option.label}</span>
                        <span class="explore-suggestion-count">${option.count}</span>
                      </button>
                    `)}
                  </div>
                `}
              </div>
              <button class="explore-field-submit" type="submit" disabled=${catalog.status === 'loading' || !tagQuery.trim()}>
                <span class="icon-symbol">search</span>
              </button>
            </div>
          </form>
          ${selectedTags.length > 0 && html`
            <div class="explore-tag-chips">
              ${selectedTags.map(tag => html`
                <div class="explore-tag-chip">
                  ${tag}
                  <button class="explore-tag-chip-remove" type="button" onClick=${() => removeTag(tag)}>
                    <span class="icon-symbol" style="font-size:14px">close</span>
                  </button>
                </div>
              `)}
            </div>
          `}
        </div>
        <div class="explore-results" role="list">
          ${catalog.status === 'loading' && html`<${LoadingNote} label="Loading album catalog…" />`}
          ${catalog.status === 'error' && html`<p class="muted" style=${{ padding: '16px' }}>Failed to load. <button class="link-chip" type="button" onClick=${() => catalog.load(true)}>Retry</button></p>`}
          ${catalog.status === 'ready' && !tagResults && html`<p class="explore-hint">Search genre/style tags — combine multiple to narrow results</p>`}
          ${catalog.status === 'ready' && tagResults && html`
            ${tagResults.length > 0
              ? html`<p class="explore-hint">${tagResults.length} album${tagResults.length !== 1 ? 's' : ''} match${tagResults.length === 1 ? 'es' : ''} all ${selectedTags.length} tag${selectedTags.length !== 1 ? 's' : ''}</p>`
              : html`<p class="muted" style=${{ padding: '16px' }}>No albums match all selected tags</p>`
            }
            ${tagResults.map(album => html`<${ExploreAlbumRow} key=${album.spotifyId || album.slug} album=${album} onClick=${handleAlbumClick} tags=${[...(album.genres || []), ...(album.styles || [])]} selectedTags=${selectedTags} onTagClick=${addTag} />`)}
          `}
        </div>
      `}
    </div>
  `;
}
