import { h, Fragment } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
import { SITE_BASE, APP_BASE, GROUP_ALBUMS_VISIBLE_DEFAULT, FAVORITE_TRACKS_VISIBLE_DEFAULT } from '../lib/constants.js';
import { clearCurrentProjectName } from '../lib/cache.js';
import {
  deriveGroupAlbumTable, deriveAlignment, deriveBacklog, deriveActivityFeed, computeUserStats,
} from '../lib/hub.js';
import { useFavoriteTracks, favoriteTrackId } from '../lib/favorites.js';
import {
  ratingTier, formatRating, formatNotifTime, formatNotification, formatDurationMs,
} from '../lib/format.js';
import { navigateForward, navigateBack, navigateTo, routePath, memberRoutePath, pairRoutePath } from '../lib/routing.js';
import { SiteModalLink, LankyMascot, LoadingNote } from './common.js';
import { useAlbumThumbs } from './explore.js';
import { trackEmbed } from './player.js';
import { useMusicService, useEmbeddablePlayers } from '../lib/settings.js';

const html = htm.bind(h);

export function GroupView({ group, members, projectName }) {
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [showAllAlbums, setShowAllAlbums] = useState(false);
  const [albumQuery, setAlbumQuery] = useState('');
  const albumTable = useMemo(() => deriveGroupAlbumTable(members), [members]);
  const alignment = useMemo(() => deriveAlignment(members), [members]);
  const thumbBySpotifyId = useAlbumThumbs();
  const sortedAlbums = useMemo(() => {
    const rows = albumTable.slice();
    if (sortBy === 'rating') {
      rows.sort((a, b) => {
        const diff = (a.averageRating ?? -1) - (b.averageRating ?? -1);
        return sortDir === 'asc' ? diff : -diff;
      });
    } else if (sortBy === 'date') {
      rows.sort((a, b) => {
        const diff = new Date(a.earliestAt) - new Date(b.earliestAt);
        return sortDir === 'asc' ? diff : -diff;
      });
    }
    return rows;
  }, [albumTable, sortBy, sortDir]);
  const albumSearchTerm = albumQuery.trim().toLowerCase();
  const filteredAlbums = useMemo(() => {
    if (!albumSearchTerm) return sortedAlbums;
    return sortedAlbums.filter((row) => {
      const album = row.album || {};
      const haystack = [
        album.name,
        album.artist,
        album.releaseDate,
        ...(album.genres || []),
        ...(album.styles || []),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(albumSearchTerm);
    });
  }, [sortedAlbums, albumSearchTerm]);
  const visibleAlbums = albumSearchTerm || showAllAlbums
    ? filteredAlbums
    : filteredAlbums.slice(0, GROUP_ALBUMS_VISIBLE_DEFAULT);

  if (!group) return html`<div class="card"><p class="muted">This project isn't part of a group.</p></div>`;

  const setAlbumSort = (key) => {
    setSortBy((current) => {
      if (current === key) {
        setSortDir((dir) => dir === 'asc' ? 'desc' : 'asc');
        return current;
      }
      setSortDir('desc');
      return key;
    });
    setShowAllAlbums(false);
  };

  const roster = group.members.map(m => {
    const proj = members[m.name];
    const unrated = proj && !proj.__error ? deriveBacklog(proj).length : null;
    const lastRated = proj && !proj.__error
      ? (proj.history || []).filter(e => 'rating' in e).slice(-1)[0]
      : null;
    return { name: m.name, unrated, lastRatedAt: lastRated ? lastRated.generatedAt : null, error: proj && proj.__error };
  }).sort((a, b) => {
    const aCaughtUp = a.unrated === 0;
    const bCaughtUp = b.unrated === 0;
    if (aCaughtUp !== bCaughtUp) return aCaughtUp ? -1 : 1;
    if (!a.lastRatedAt && !b.lastRatedAt) return 0;
    if (!a.lastRatedAt) return 1;
    if (!b.lastRatedAt) return -1;
    return new Date(b.lastRatedAt) - new Date(a.lastRatedAt);
  });

  return html`
    <div>
      <div class="card te-panel">
        <h2>${group.name}</h2>
        <div class="grid cols-3">
          <div class="stat"><div class="num">${group.numberOfGeneratedAlbums}</div><div class="label">Albums</div></div>
          <div class="stat"><div class="num">${group.totalVotes}</div><div class="label">Votes</div></div>
          <div class="stat"><div class="num">${group.averageRating}</div><div class="label">Avg Rating</div></div>
        </div>
      </div>

      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div class="card te-panel">
          <h3>Group Favorites</h3>
          <p>Decade: <strong>${group.ratingByDecade && group.ratingByDecade.length ? group.ratingByDecade.slice().sort((a,b)=>b.rating-a.rating)[0].decade : '—'}</strong></p>
          <p>Genre: <strong>${group.favoriteGenres && group.favoriteGenres[0] ? group.favoriteGenres[0].genre : '—'}</strong></p>
        </div>
        <div class="card te-panel">
          <h3>Group Least Favorites</h3>
          <p>Genre: <strong>${group.worstGenres && group.worstGenres[0] ? group.worstGenres[0].genre : '—'}</strong></p>
        </div>
      </div>

      <div class="card te-panel">
        <h2>Roster</h2>
        <div class="data-card-list data-card-list--3col">
          ${roster.map(r => html`
            <button class="data-card" onClick=${() => navigateForward(memberRoutePath(projectName, r.name))}>
              <div class="data-card-main">
                <div class="data-card-title">${r.name}${r.name === projectName ? html` <span class="muted" style=${{ fontWeight: 400 }}>(you)</span>` : ''}</div>
                <div class="data-card-sub">${r.lastRatedAt ? `Last rated ${new Date(r.lastRatedAt).toLocaleDateString()}` : 'No ratings yet'}</div>
              </div>
              <div class="data-card-aside">
                ${r.error ? '—' : r.unrated > 0 ? html`<span class="badge">${r.unrated} unrated</span>` : html`<span style=${{ color: 'var(--good)' }}>✓ caught up</span>`}
              </div>
            </button>
          `)}
        </div>
      </div>

      <div class="card te-panel">
        <h2>All Rated Albums (${albumSearchTerm ? `${filteredAlbums.length}/${sortedAlbums.length}` : sortedAlbums.length})</h2>
        <input
          type="search"
          placeholder="Filter by album, artist, genre, or year…"
          value=${albumQuery}
          onInput=${(e) => { setAlbumQuery(e.target.value); setShowAllAlbums(false); }}
          style=${{ width: '100%', padding: '7px 10px', marginBottom: '10px', border: '1px solid var(--border)', borderRadius: '6px', font: 'inherit', fontSize: '13px', background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' }}
        />
        <div class="sort-controls">
          <button
            class=${sortBy === 'date' ? 'active' : ''}
            onClick=${() => setAlbumSort('date')}
            aria-sort=${sortBy === 'date' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
          >Date ${sortBy === 'date' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</button>
          <button
            class=${sortBy === 'rating' ? 'active' : ''}
            onClick=${() => setAlbumSort('rating')}
            aria-sort=${sortBy === 'rating' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
          >Rating ${sortBy === 'rating' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</button>
        </div>
        <div class="data-card-list">
          ${visibleAlbums.map(r => {
            const thumbUrl = thumbBySpotifyId.get(r.album.spotifyId);
            return html`
              <button class="data-card" onClick=${() => navigateForward(routePath(projectName, 'album', r.album.uuid, 'group'))}>
                ${thumbUrl
                  ? html`<img class="explore-album-thumb" src=${thumbUrl} alt="" loading="lazy" decoding="async" />`
                  : html`<div class="explore-album-thumb"></div>`
                }
                <div class="data-card-main">
                  <div class="data-card-title">${r.album.name}</div>
                  <div class="data-card-sub">${r.album.artist}</div>
                </div>
                <div class="data-card-aside">
                  ${r.averageRating != null
                    ? html`<div><span class=${`rating-tier-${ratingTier(r.averageRating)}`} style=${{ fontWeight: 700 }}>${r.averageRating} ★</span></div>`
                    : html`<div class="muted">—</div>`
                  }
                  <div class="muted">${r.votes} vote${r.votes !== 1 ? 's' : ''}</div>
                </div>
              </button>
            `;
          })}
        </div>
        ${albumSearchTerm && filteredAlbums.length === 0 && html`
          <p class="muted" style=${{ padding: '8px 0 0' }}>No rated albums match "${albumQuery}".</p>
        `}
        ${!albumSearchTerm && filteredAlbums.length > GROUP_ALBUMS_VISIBLE_DEFAULT && html`
          <a class="show-all-link" href="#" onClick=${(e) => { e.preventDefault(); setShowAllAlbums(!showAllAlbums); }}>${showAllAlbums ? 'Show fewer' : `Show all ${filteredAlbums.length} →`}</a>
        `}
      </div>

      <div class="card te-panel">
        <h2>Taste Alignment</h2>
        <p class="disclaimer">Our own estimate (100 × (1 − mean rating difference ÷ 4) over albums both members rated, min. 2 shared) — not the site's official algorithm. See the <${SiteModalLink} href=${`${SITE_BASE}/groups/${encodeURIComponent(group.slug)}/taste-alignments`} title="Official alignments">official Alignments page<//> for that.</p>
        <div class="data-card-list">
          ${alignment.map(p => {
            const left = p.b === projectName ? p.b : p.a;
            const right = p.b === projectName ? p.a : p.b;
            return html`
            <button class="data-card" onClick=${() => navigateForward(pairRoutePath(projectName, p.a, p.b))}>
              <div class="data-card-main">
                <div class="data-card-title">${left} ↔ ${right}</div>
                <div class="alignment-bar-wrap">
                  <div class="alignment-bar" style=${{ width: `${p.alignment}%` }}></div>
                </div>
              </div>
              <div class="data-card-aside">
                <span class="alignment-pct">${p.alignment}%</span>
                <div class="data-card-sub">${p.shared} shared</div>
              </div>
            </button>
          `;})}
        </div>
      </div>
    </div>
  `;
}

// ---------- Activity ----------
export function ActivityView({ members, projectName, group, notifications }) {
  const feed = useMemo(() => deriveActivityFeed(members), [members]);
  const thumbBySpotifyId = useAlbumThumbs();
  const feedByDay = useMemo(() => {
    const groups = [];
    let current = null;
    for (const item of feed) {
      const day = new Date(item.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      if (!current || current.day !== day) {
        current = { day, items: [] };
        groups.push(current);
      }
      current.items.push(item);
    }
    return groups;
  }, [feed]);
  return html`
    <div>
      ${(notifications.status !== 'ready' || notifications.notifications.length > 0) && html`
        <div class="card te-panel">
          <div class="activity-panel-header">
            <span class="activity-panel-title">Notifications${notifications.notifications.length > 0 ? ` (${notifications.notifications.length})` : ''}</span>
            ${notifications.status === 'ready' && notifications.notifications.length > 0 && html`
              <button type="button" class="pill-btn" disabled=${notifications.markingRead} onClick=${notifications.markAllRead}>
                ${notifications.markingRead ? 'Marking…' : 'Mark as read'}
              </button>
            `}
          </div>
          ${notifications.markReadMessage && html`<p class="muted">${notifications.markReadMessage}</p>`}
          ${notifications.status === 'loading' && html`<${LoadingNote} label="Loading notifications…" />`}
          ${notifications.status === 'error' && html`<p class="muted">${notifications.errorMessage || "Couldn't load notifications."}</p>`}
          ${notifications.status === 'ready' && html`
            <div class="data-card-list">
              ${notifications.notifications.map(n => {
                const { text, prefix, albumName, suffix, albumId } = formatNotification(n);
                const isAlbum = prefix != null;
                const El = isAlbum ? 'button' : 'div';
                return html`
                  <${El}
                    class="data-card"
                    key=${n._id}
                    onClick=${isAlbum ? () => navigateForward(routePath(projectName, 'album', albumId, 'group')) : undefined}
                  >
                    <div class="data-card-main">
                      <div class="data-card-title">${isAlbum ? albumName : text}</div>
                      ${isAlbum && html`<div class="data-card-sub">${prefix}${suffix}</div>`}
                    </div>
                    <div class="data-card-aside">${formatNotifTime(new Date(n.createdAt))}</div>
                  <//>
                `;
              })}
            </div>
          `}
        </div>
      `}

      <div class="card te-panel">
        <div class="activity-panel-header">
          <span class="activity-panel-title">Activity</span>
          ${!group && html`<span class="muted" style=${{ fontSize: '12px' }}>Your history</span>`}
        </div>
        ${feed.length === 0 ? html`
          <p class="muted"><${LankyMascot} />No one's rated anything yet.</p>
        ` : html`
          <div class="data-card-list">
            ${feedByDay.map(dayGroup => html`
              <div class="activity-day-group" key=${dayGroup.day}>
                <div class="activity-day-header">${dayGroup.day}</div>
                ${dayGroup.items.map((item, i) => {
                  const thumbUrl = item.album?.spotifyId && thumbBySpotifyId.get(item.album.spotifyId);
                  const isYou = item.member === projectName;
                  return html`
                    <button class="data-card" key=${`${item.member}-${item.album.uuid}-${i}`}
                      onClick=${() => navigateForward(routePath(projectName, 'album', item.album.uuid, 'group'))}>
                      ${thumbUrl
                        ? html`<img class="explore-album-thumb" src=${thumbUrl} alt="" loading="lazy" decoding="async" />`
                        : html`<div class="explore-album-thumb"></div>`}
                      <div class="data-card-main">
                        <div class="data-card-title">${item.album.name}</div>
                        <div class="data-card-sub">${item.album.artist} · ${isYou ? 'you' : item.member}</div>
                        ${item.review && html`<div class="data-card-sub activity-review-text">${item.review}</div>`}
                      </div>
                      <div class="data-card-aside">
                        ${item.rating === 'did-not-listen'
                          ? html`<span class="muted">DNL</span>`
                          : html`<span class=${`rating-tier-${ratingTier(item.rating)}`} style=${{ fontWeight: 700 }}>${item.rating} ★</span>`}
                      </div>
                    </button>
                  `;
                })}
              </div>
            `)}
          </div>
        `}
      </div>
    </div>
  `;
}

// ---------- Pair ----------
export function PairDetailView({ projectName, members, pairA, pairB }) {
  const alignment = useMemo(() => deriveAlignment(members), [members]);
  const pair = alignment.find(p => (p.a === pairA && p.b === pairB) || (p.a === pairB && p.b === pairA));
  const [sortDir, setSortDir] = useState('desc');
  const thumbBySpotifyId = useAlbumThumbs();
  const sortedDetails = useMemo(() => {
    if (!pair) return [];
    return [...pair.details].sort((a, b) => sortDir === 'desc' ? b.diff - a.diff : a.diff - b.diff);
  }, [pair, sortDir]);

  if (!pair) {
    return html`
      <div class="card te-panel">
        <h2>Taste Alignment</h2>
        <p class="muted">Couldn't find a comparison for ${pairA} and ${pairB} — they may not have enough albums rated in common.</p>
        <a class="pill-btn primary" href=${routePath(projectName, 'group')} onClick=${(e) => { e.preventDefault(); navigateBack(routePath(projectName, 'group')); }}>← Back to group</a>
      </div>
    `;
  }

  return html`
    <div>
      <div class="banner te-banner">
        <strong>${pair.a} ↔ ${pair.b}: ${pair.alignment}% aligned</strong>
        <span class="spacer"></span>
        <a class="pill-btn primary" href=${routePath(projectName, 'group')} onClick=${(e) => { e.preventDefault(); navigateBack(routePath(projectName, 'group')); }}>← Back to group</a>
      </div>
      <div class="card te-panel">
        <h2>Shared Albums (${pair.shared})</h2>
        <div class="sort-controls">
          <button class=${sortDir === 'desc' ? 'active' : ''} onClick=${() => setSortDir('desc')}>Most disagreed</button>
          <button class=${sortDir === 'asc' ? 'active' : ''} onClick=${() => setSortDir('asc')}>Most agreed</button>
        </div>
        <div class="data-card-list">
          ${sortedDetails.map(d => {
            const thumbUrl = d.album?.spotifyId && thumbBySpotifyId.get(d.album.spotifyId);
            return html`
              <button class="data-card" onClick=${d.album ? () => navigateForward(routePath(projectName, 'album', d.album.uuid, 'group')) : undefined} style=${!d.album ? { cursor: 'default' } : {}}>
                ${thumbUrl
                  ? html`<img class="explore-album-thumb" src=${thumbUrl} alt="" loading="lazy" decoding="async" />`
                  : html`<div class="explore-album-thumb"></div>`
                }
                <div class="data-card-main">
                  <div class="data-card-title">${d.album ? d.album.name : '—'}</div>
                  <div class="data-card-sub">${d.album ? d.album.artist : ''}</div>
                </div>
                <div class="data-card-aside">
                  <div><span class=${`rating-tier-${ratingTier(d.ratingA)}`} style=${{ fontWeight: 700 }}>${formatRating(d.ratingA)} ★</span> <span class="muted">${pair.a}</span></div>
                  <div><span class=${`rating-tier-${ratingTier(d.ratingB)}`} style=${{ fontWeight: 700 }}>${formatRating(d.ratingB)} ★</span> <span class="muted">${pair.b}</span></div>
                </div>
              </button>
            `;
          })}
        </div>
      </div>
    </div>
  `;
}

// ---------- Me ----------
export function MemberView({ memberName, project, projectName }) {
  const history = (project && !project.__error ? project.history || [] : [])
    .filter(e => 'rating' in e)
    .slice()
    .reverse();
  const thumbBySpotifyId = useAlbumThumbs();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter(e =>
      e.album?.name?.toLowerCase().includes(q) ||
      e.album?.artist?.toLowerCase().includes(q) ||
      e.review?.toLowerCase().includes(q)
    );
  }, [history, query]);
  return html`
    <div>
      <div class="banner te-banner">
        <strong>${memberName}</strong>
        <span class="spacer"></span>
        <a class="pill-btn primary" href=${routePath(projectName, 'group')} onClick=${(e) => { e.preventDefault(); navigateBack(routePath(projectName, 'group')); }}>← Back to group</a>
      </div>
      ${!project && html`<div class="card te-panel"><p class="muted">Loading member data…</p></div>`}
      ${project && project.__error && html`<div class="card te-panel"><p class="muted">Couldn't load data for ${memberName}.</p></div>`}
      ${history.length > 0 && html`
        <div class="card te-panel">
          <div class="sort-controls" style=${{ marginBottom: '10px' }}>
            <input
              type="search"
              class="explore-input"
              placeholder="Search albums, artists, reviews…"
              value=${query}
              onInput=${(e) => setQuery(e.target.value)}
            />
          </div>
          <div class="data-card-list">
            ${filtered.length === 0 && html`<p class="muted">No results.</p>`}
            ${filtered.map(e => {
              const thumbUrl = e.album?.spotifyId && thumbBySpotifyId.get(e.album.spotifyId);
              return html`
                <button class="data-card" style=${{ alignItems: 'flex-start' }} onClick=${() => navigateForward(routePath(projectName, 'album', e.album.uuid, 'group'))}>
                  ${thumbUrl
                    ? html`<img class="explore-album-thumb" src=${thumbUrl} alt="" loading="lazy" decoding="async" />`
                    : html`<div class="explore-album-thumb"></div>`
                  }
                  <div class="data-card-main">
                    <div class="data-card-title">${e.album.name}</div>
                    <div class="data-card-sub">${e.album.artist}</div>
                    ${e.review && html`<div class="activity-review-text">${e.review}</div>`}
                  </div>
                  <div class="data-card-aside">
                    <span class=${`rating-tier-${ratingTier(e.rating)}`} style=${{ fontWeight: 700 }}>${e.rating} ★</span>
                  </div>
                </button>
              `;
            })}
          </div>
        </div>
      `}
    </div>
  `;
}

export function MeView({ me, projectName }) {
  const stats = useMemo(() => computeUserStats(me), [me]);
  const switchUser = () => {
    clearCurrentProjectName();
    navigateTo(APP_BASE);
  };
  return html`
    <div>
      <div class="card te-panel">
        <h2>${projectName}</h2>
        <p class="muted">This browser opens your Today page by default.</p>
        <button type="button" class="pill-btn" onClick=${switchUser}>Switch user</button>
      </div>
      <div class="card te-panel">
        <h2>Crate Stats</h2>
        <div class="grid cols-3">
          <div class="stat"><div class="num">${stats.totalRated}</div><div class="label">Rated</div></div>
          <div class="stat"><div class="num">${stats.avgRating != null ? stats.avgRating : '—'}</div><div class="label">Avg Rating</div></div>
          <div class="stat"><div class="num">${stats.dnl}</div><div class="label">Did Not Listen</div></div>
        </div>
      </div>
      <div class="card te-panel">
        <h3>Rating Distribution</h3>
        ${[5, 4, 3, 2, 1].map(n => html`
          <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style=${{ width: '14px' }}>${n}</span>
            <div class="bar" style=${{ flex: 1 }}><div class=${`fill-tier-${ratingTier(n)}`} style=${{ width: `${stats.totalRated ? (stats.dist[n] / stats.totalRated) * 100 : 0}%` }}></div></div>
            <span class="muted" style=${{ width: '24px', textAlign: 'right' }}>${stats.dist[n]}</span>
          </div>
        `)}
      </div>
      <${BreakdownStats} genres=${stats.genres} styles=${stats.styles} decades=${stats.decades} ratings=${stats.ratings} projectName=${projectName} />
      <${FavoriteTracksSection} projectName=${projectName} />
      <p class="muted">For a fuller polished writeup, see your <${SiteModalLink} href=${`${SITE_BASE}/shares/${encodeURIComponent(me.shareableUrl ? me.shareableUrl.split('/').pop() : '')}`} title="Official summary">official Summary page<//>.</p>
    </div>
  `;
}


export function FavoriteTracksSection({ projectName }) {
  const favorites = useFavoriteTracks(projectName);
  const musicService = useMusicService();
  const players = useEmbeddablePlayers();
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [activeEmbedTrackId, setActiveEmbedTrackId] = useState(null);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? favorites.list.filter(t => (t.title || '').toLowerCase().includes(q) || (t.artistName || '').toLowerCase().includes(q) || (t.albumName || '').toLowerCase().includes(q))
    : favorites.list;
  let visible = showAll ? filtered : filtered.slice(0, FAVORITE_TRACKS_VISIBLE_DEFAULT);
  // Pin the actively-playing track into view even if a search/limit would otherwise exclude it —
  // filtering it out unmounts its iframe and kills playback out from under the user.
  if (activeEmbedTrackId && !visible.some(t => favoriteTrackId(t) === activeEmbedTrackId)) {
    const activeTrack = favorites.list.find(t => favoriteTrackId(t) === activeEmbedTrackId);
    if (activeTrack) visible = [activeTrack, ...visible];
  }

  if (favorites.list.length === 0) {
    return html`
      <div class="card te-panel">
        <h3>Favorite Tracks</h3>
        <p class="muted">Star tracks on an album's Tracks tab to collect them here.</p>
        ${favorites.errorMessage && html`<p class="muted">${favorites.errorMessage}</p>`}
      </div>
    `;
  }
  return html`
    <div class="card te-panel">
      <h3>Favorite Tracks (${favorites.list.length})</h3>
      <p class="muted">Synced to this 1001 Albums project name — anyone using the same name shares this list.</p>
      ${favorites.errorMessage && html`<p class="muted">${favorites.errorMessage}</p>`}
      <input
        type="search"
        placeholder="Filter by track, artist, or album…"
        value=${query}
        onInput=${(e) => setQuery(e.target.value)}
        style=${{ width: '100%', padding: '7px 10px', marginBottom: '10px', border: '1px solid var(--border)', borderRadius: '6px', font: 'inherit', fontSize: '13px', background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' }}
      />
      <div class="data-card-list">
        ${visible.map(track => {
          const trackId = favoriteTrackId(track);
          const embed = players.enabled ? trackEmbed(track, musicService.preference) : null;
          const embedOpen = trackId && activeEmbedTrackId === trackId;
          return html`
            <${Fragment}>
              <div class="data-card">
                <button type="button" class="star-btn active" aria-label="Unfavorite track" onClick=${() => favorites.toggle(track)}>★</button>
                ${embed && trackId && html`
                  <button
                    type="button"
                    class=${`embed-btn ${embedOpen ? 'active' : ''}`}
                    aria-label=${embedOpen ? 'Hide track player' : `Play preview with ${embed.service}`}
                    title=${embedOpen ? 'Hide player' : `Play with ${embed.service}`}
                    onClick=${() => setActiveEmbedTrackId(current => current === trackId ? null : trackId)}
                  ><span class="icon-symbol">${embedOpen ? 'expand_less' : 'play_arrow'}</span></button>
                `}
                ${track.artworkUrl
                  ? html`<img src=${track.artworkUrl} alt="" width="44" height="44" loading="lazy" style=${{ borderRadius: '4px', display: 'block', flexShrink: 0, objectFit: 'cover' }} />`
                  : html`<div class="explore-album-thumb"></div>`
                }
                <div class="data-card-main">
                  <div class="data-card-title">
                    ${track.trackViewUrl
                      ? html`<a href=${track.trackViewUrl} target="_blank" rel="noopener" class="track-link" title="Open track">${track.title || `Unknown track (${favoriteTrackId(track) || 'unknown id'})`}</a>`
                      : (track.title || `Unknown track (${favoriteTrackId(track) || 'unknown id'})`)}
                  </div>
                  <div class="data-card-sub">${track.artistName || '—'} · ${track.albumName || '—'}</div>
                </div>
                <div class="data-card-aside">
                  <span class="muted">${formatDurationMs(track.durationMs)}</span>
                </div>
              </div>
              ${embedOpen && html`
                <div style=${{ padding: '0 8px 4px' }}>
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
                </div>
              `}
            <//>
          `;
        })}
      </div>
      ${filtered.length > FAVORITE_TRACKS_VISIBLE_DEFAULT && html`
        <a class="show-all-link" href="#" onClick=${(e) => { e.preventDefault(); setShowAll(!showAll); }}>${showAll ? 'Show fewer' : `Show all ${filtered.length} →`}</a>
      `}
    </div>
  `;
}

export function AlbumCardList({ albums, projectName, thumbBySpotifyId }) {
  return html`
    <div class="data-card-list">
      ${albums.map((a) => {
        const thumbUrl = a.album?.spotifyId && thumbBySpotifyId.get(a.album.spotifyId);
        return html`
          <button class="data-card" onClick=${() => navigateForward(routePath(projectName, 'album', a.album.uuid))}>
            ${thumbUrl
              ? html`<img class="explore-album-thumb" src=${thumbUrl} alt="" loading="lazy" decoding="async" />`
              : html`<div class="explore-album-thumb"></div>`
            }
            <div class="data-card-main">
              <div class="data-card-title">${a.album.name}</div>
              <div class="data-card-sub">${a.album.artist}</div>
            </div>
            <div class="data-card-aside">
              ${a.rating != null
                ? html`<span class=${`rating-tier-${ratingTier(a.rating)}`} style=${{ fontWeight: 700 }}>${formatRating(a.rating)} ★</span>`
                : html`<span class="muted">—</span>`
              }
            </div>
          </button>
        `;
      })}
    </div>
  `;
}

export function BreakdownStats({ genres, styles, decades, ratings, projectName }) {
  const dimensions = {
    genre:  { label: 'By Genre',  items: genres,  keyOf: (i) => i.genre,  labelOf: (i) => i.genre },
    style:  { label: 'By Style',  items: styles,  keyOf: (i) => i.style,  labelOf: (i) => i.style },
    decade: { label: 'By Decade', items: decades, keyOf: (i) => i.decade, labelOf: (i) => `${i.decade}s` },
    all:    { label: 'All' },
  };
  const [dimension, setDimension] = useState('genre');
  const [expanded, setExpanded] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const thumbBySpotifyId = useAlbumThumbs();

  const selectDimension = (key) => { setDimension(key); setExpanded(null); setShowAll(false); };

  const q = query.trim().toLowerCase();
  const filterAlbums = (list) => q
    ? list.filter(a => a.album.name.toLowerCase().includes(q) || a.album.artist.toLowerCase().includes(q))
    : list;

  const current = dimensions[dimension];

  let body;
  if (dimension === 'all') {
    const filtered = filterAlbums(ratings);
    body = html`<${AlbumCardList} albums=${filtered} projectName=${projectName} thumbBySpotifyId=${thumbBySpotifyId} />`;
  } else {
    const items = current.items;
    const activeItem = items.find((i) => current.keyOf(i) === expanded);
    if (q) {
      const pool = activeItem
        ? activeItem.albums
        : (() => {
            const seen = new Set();
            return items.flatMap(i => i.albums).filter(a => {
              if (seen.has(a.album.uuid)) return false;
              seen.add(a.album.uuid);
              return true;
            });
          })();
      const filtered = filterAlbums(pool);
      body = html`
        <div class="keyword-row" style=${{ marginBottom: '10px' }}>
          ${activeItem && html`<button type="button" class="style-chip active" onClick=${() => setExpanded(null)}>
            <span class="style-chip-name">${current.labelOf(activeItem)}</span>
            <span class=${`style-chip-rating tier-${ratingTier(activeItem.avg)}`}>${activeItem.avg}</span>
          </button>`}
        </div>
        <${AlbumCardList} albums=${filtered} projectName=${projectName} thumbBySpotifyId=${thumbBySpotifyId} />
      `;
    } else {
      const visible = showAll ? items : items.slice(0, 100);
      body = html`
        <p class="muted">Click one to see the albums in it.</p>
        <div class="keyword-row">
          ${visible.map((i) => html`
            <button type="button" class=${`style-chip ${expanded === current.keyOf(i) ? 'active' : ''}`} onClick=${() => setExpanded(expanded === current.keyOf(i) ? null : current.keyOf(i))}>
              <span class="style-chip-name">${current.labelOf(i)}</span>
              <span class=${`style-chip-rating tier-${ratingTier(i.avg)}`}>${i.avg}</span>
              <span class="style-chip-count">(${i.count})</span>
            </button>
          `)}
        </div>
        ${items.length > 100 && html`
          <a class="show-all-link" href="#" onClick=${(e) => { e.preventDefault(); setShowAll(!showAll); }}>${showAll ? 'Show fewer' : `Show all ${items.length} →`}</a>
        `}
        ${activeItem && html`
          <div style=${{ marginTop: '10px' }}>
            <${AlbumCardList} albums=${activeItem.albums} projectName=${projectName} thumbBySpotifyId=${thumbBySpotifyId} />
          </div>
        `}
      `;
    }
  }

  return html`
    <div class="card te-panel">
      <div class="album-panel-tabs">
        ${Object.entries(dimensions).map(([key, d]) => html`
          <button type="button" class=${`album-panel-tab ${dimension === key ? 'active' : ''}`} onClick=${() => selectDimension(key)}>${d.label}</button>
        `)}
      </div>
      <input
        type="search"
        placeholder="Filter by album or artist…"
        value=${query}
        onInput=${(e) => { setQuery(e.target.value); setExpanded(null); }}
        style=${{ width: '100%', padding: '7px 10px', marginBottom: '10px', border: '1px solid var(--border)', borderRadius: '6px', font: 'inherit', fontSize: '13px', background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' }}
      />
      ${body}
    </div>
  `;
}
