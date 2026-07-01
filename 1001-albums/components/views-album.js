import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
import { saveListeningNote, saveRating } from '../lib/api.js';
import { routePath, navigateSubTab, navigateTab, navigateBack, navigateForward, haptic } from '../lib/routing.js';
import { backlogEntryId, deriveGroupAlbumTable } from '../lib/hub.js';
import { ratingTier, formatRating } from '../lib/format.js';
import { AlbumPlayButton } from './player.js';
import { StreamingLinks, LankyMascot } from './common.js';
import { AlbumSummaryContext, AlbumInfoTabs } from './album.js';
import { useEditorState, useAlbumThumbs } from './explore.js';

const html = htm.bind(h);

export function ListeningNoteEditor({ projectName, albumId, initialNotes }) {
  const { notes, setNotes, status, setStatus, errorMessage, setErrorMessage } = useEditorState(initialNotes, albumId);

  const save = async () => {
    setStatus('saving');
    try {
      await saveListeningNote(projectName, albumId, notes);
      setStatus('saved');
    } catch (e) {
      setStatus('error');
      setErrorMessage(e.message || "Couldn't save — try again.");
    }
  };

  return html`
    <div style=${{ marginTop: '12px' }}>
      <div class="context-section-title" data-badge="edit_note">Listening Notes</div>
      <textarea
        class="rate-optional-notes"
        style=${{ width: '100%', minHeight: '180px', padding: '8px 10px', font: 'inherit', resize: 'vertical' }}
        placeholder="Optional listening note…"
        value=${notes}
        onInput=${(e) => { setNotes(e.target.value); setStatus('idle'); }}
        enterkeyhint="enter" autocomplete="off"
      ></textarea>
      <div style=${{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
        <button class="pill-btn primary" type="button" disabled=${status === 'saving'} onClick=${save}>
          ${status === 'saving' ? 'Saving…' : 'Save note'}
        </button>
        ${status === 'saved' && html`<span class="muted">Saved.</span>`}
        ${status === 'error' && html`<span class="muted">${errorMessage}</span>`}
      </div>
    </div>
  `;
}

export function RatingEditor({ projectName, albumUuid, generatedAlbumId, initialNotes, onRated }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const { notes, setNotes, status, setStatus, errorMessage, setErrorMessage } = useEditorState(initialNotes, albumUuid);

  const submit = async () => {
    if (!rating) return;
    setStatus('saving');
    try {
      await saveRating(projectName, albumUuid, generatedAlbumId, rating, notes);
      setStatus('saved');
      haptic([10, 40, 20]);
      if (onRated) onRated();
    } catch (e) {
      setStatus('error');
      haptic([30, 50, 30]);
      setErrorMessage(e.message || "Couldn't submit rating — try again.");
    }
  };

  return html`
    <div style=${{ marginTop: '12px', marginBottom: '16px' }}>
      <div class="context-section-title" data-badge="rate_review">Rate Album</div>
      <div class="rating-stars" role="group" aria-label="Rating" onMouseLeave=${() => setHoverRating(0)}>
        ${[1, 2, 3, 4, 5].map(n => html`
          <button
            type="button"
            class=${`star-pick ${n <= (hoverRating || rating) ? 'active' : ''}`}
            aria-label=${`${n} star${n === 1 ? '' : 's'}`}
            onMouseEnter=${() => setHoverRating(n)}
            onClick=${() => { haptic(8); setRating(n); setStatus('idle'); }}
          >★</button>
        `)}
      </div>
      <textarea
        class="rate-optional-notes"
        style=${{ width: '100%', minHeight: '180px', padding: '8px 10px', font: 'inherit', resize: 'vertical', marginTop: '8px' }}
        placeholder="Optional review…"
        value=${notes}
        onInput=${(e) => { setNotes(e.target.value); setStatus('idle'); }}
        enterkeyhint="enter" autocomplete="off"
      ></textarea>
      <div style=${{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
        <button class="pill-btn primary" type="button" disabled=${status === 'saving' || !rating} onClick=${submit}>
          ${status === 'saving' ? 'Submitting…' : 'Submit rating'}
        </button>
        ${status === 'saved' && html`<span class="muted">Saved.</span>`}
        ${status === 'error' && html`<span class="muted">${errorMessage}</span>`}
      </div>
    </div>
  `;
}

// ---------- Today ----------
// Shared two-column "spotlight" layout for a single album: art/title/genres/streaming links on
// the left, the info tabs (wiki summary, How We Compare, discovery links) plus a caller-supplied
// action (listening note editor, rating editor, ...) on the right. Used by both Today and the
// Backlog album view so the two stay visually consistent as one gets tweaked.
export function AlbumSpotlight({ album, projectName, groupSlug = null, comparison = null, tab, onTabChange, action = null, groupReviews = null }) {
  return html`
    <div class="today-layout">
      <div class="today-primary">
        ${album.images && album.images[0] && html`<img class="album-art" src=${album.images[0].url} alt=${album.name} loading="lazy" decoding="async" />`}
        <div class="album-header-row">
          <div class="album-header-text">
            <p class="album-title">${album.name}</p>
            <p class="album-artist">${album.artist}${album.releaseDate ? ` (${album.releaseDate})` : ''}</p>
          </div>
          <${AlbumPlayButton} album=${album} />
          <${StreamingLinks} album=${album} />
        </div>
        <${AlbumSummaryContext} album=${album} projectName=${projectName} sections=${['genres', 'discovery']} />
      </div>
      <div class="today-secondary">
        <${AlbumInfoTabs} album=${album} projectName=${projectName} groupSlug=${groupSlug} tab=${tab} onTabChange=${onTabChange} comparison=${comparison} summarySections=${['compare']} groupReviews=${groupReviews} />
        ${action}
      </div>
    </div>
  `;
}

export function TodayView({ projectName, me, backlog, subTab, comparison }) {
  const album = me.currentAlbum;
  const tab = subTab || 'summary';
  const setTab = (t) => navigateSubTab(routePath(projectName, 'today', null, t === 'summary' ? null : t));
  return html`
    <div>
      ${backlog.length > 0 && html`
        <div class="banner te-banner">
          <strong>${backlog.length} album${backlog.length === 1 ? '' : 's'} to rate</strong>
          <span class="spacer"></span>
          <a class="primary" href=${routePath(projectName, 'backlog')} onClick=${(e) => { e.preventDefault(); navigateTab(routePath(projectName, 'backlog')); }}>View backlog →</a>
        </div>
      `}
      <div class="card te-panel">
        ${album ? html`
          <${AlbumSpotlight}
            album=${album}
            projectName=${projectName}
            comparison=${comparison}
            tab=${tab}
            onTabChange=${setTab}
            action=${html`<${ListeningNoteEditor} projectName=${projectName} albumId=${album.uuid} initialNotes=${me.currentAlbumNotes} />`}
          />
        ` : html`<p class="muted">No current album returned by the API.</p>`}
      </div>
    </div>
  `;
}

// ---------- Backlog ----------
export function BacklogAlbumView({ projectName, entry, groupSlug, comparison, subTab, onRated }) {
  if (!entry) {
    return html`
      <div class="card">
        <h2>Backlog Album</h2>
        <p class="muted">That album isn't in your current unrated backlog.</p>
        <a class="pill-btn primary" href=${routePath(projectName, 'backlog')} onClick=${(e) => { e.preventDefault(); navigateBack(routePath(projectName, 'backlog')); }}>← Back to backlog</a>
      </div>
    `;
  }

  const album = entry.album;
  const tab = subTab || 'summary';
  const setTab = (t) => navigateSubTab(routePath(projectName, 'backlog', backlogEntryId(entry), t === 'summary' ? null : t));
  return html`
    <div>
      <div class="banner te-banner">
        <strong>Unrated album from ${new Date(entry.generatedAt).toLocaleDateString()}</strong>
        <span class="spacer"></span>
        <a class="primary" href=${routePath(projectName, 'backlog')} onClick=${(e) => { e.preventDefault(); navigateTab(routePath(projectName, 'backlog')); }}>View backlog →</a>
      </div>
      <div class="card te-panel">
        <${AlbumSpotlight}
          album=${album}
          projectName=${projectName}
          groupSlug=${groupSlug}
          comparison=${comparison}
          tab=${tab}
          onTabChange=${setTab}
          action=${html`<${RatingEditor} projectName=${projectName} albumUuid=${album.uuid} generatedAlbumId=${entry.generatedAlbumId} initialNotes=${entry.review} onRated=${onRated} />`}
        />
      </div>
    </div>
  `;
}

export function AlbumDetailView({ projectName, albumRecord, groupSlug, comparison, subTab }) {
  if (!albumRecord) {
    return html`
      <div class="card">
        <h2>Album</h2>
        <p class="muted">That album wasn't found in the loaded group history.</p>
        <a class="pill-btn primary" href=${routePath(projectName, 'group')} onClick=${(e) => { e.preventDefault(); navigateBack(routePath(projectName, 'group')); }}>← Back to group</a>
      </div>
    `;
  }

  const album = albumRecord.album;
  const tab = subTab || 'summary';
  const setTab = (t) => navigateSubTab(routePath(projectName, 'album', album.uuid, t === 'summary' ? null : t));
  const groupReviews = useMemo(() =>
    albumRecord.occurrences
      .map(({ member, entry }) => ({
        projectName: member,
        rating: 'rating' in entry ? entry.rating : null,
        review: entry.review || '',
      }))
      .filter(review => review.rating != null || review.review),
  [albumRecord]);
  return html`
    <div>
      <div class="banner te-banner">
        <strong>Generated ${new Date(albumRecord.generatedAt).toLocaleDateString()}</strong>
        <span class="spacer"></span>
        <a class="pill-btn primary" href=${routePath(projectName, 'group')} onClick=${(e) => { e.preventDefault(); navigateBack(routePath(projectName, 'group')); }}>← Back to group</a>
      </div>
      <div class="card te-panel">
        <${AlbumSpotlight}
          album=${album}
          projectName=${projectName}
          groupSlug=${groupSlug}
          comparison=${comparison}
          tab=${tab}
          onTabChange=${setTab}
          groupReviews=${groupReviews}
        />
      </div>
    </div>
  `;
}

export function BacklogView({ projectName, backlog, members }) {
  const groupRatings = useMemo(() => {
    const map = new Map();
    for (const row of deriveGroupAlbumTable(members)) map.set(row.album.uuid, row);
    return map;
  }, [members]);
  const thumbBySpotifyId = useAlbumThumbs();

  return html`
    <div class="card te-panel">
      <h2>Unrated Albums</h2>
      ${backlog.length === 0 ? html`
        <p class="muted"><${LankyMascot} />Lanky says: you're all caught up!</p>
      ` : html`
        <div class="data-card-list">
          ${backlog.map(e => {
            const groupRow = groupRatings.get(e.album.uuid);
            const href = routePath(projectName, 'backlog', backlogEntryId(e));
            const thumbUrl = thumbBySpotifyId.get(e.album.spotifyId);
            return html`
              <button class="data-card" onClick=${() => navigateForward(href)}>
                ${thumbUrl
                  ? html`<img class="explore-album-thumb" src=${thumbUrl} alt="" loading="lazy" decoding="async" />`
                  : html`<div class="explore-album-thumb"></div>`
                }
                <div class="data-card-main">
                  <div class="data-card-title">${e.album.name}</div>
                  <div class="data-card-sub">${e.album.artist} · ${new Date(e.generatedAt).toLocaleDateString()}</div>
                </div>
                <div class="data-card-aside">
                  ${groupRow?.averageRating != null
                    ? html`<div><span class=${`rating-tier-${ratingTier(groupRow.averageRating)}`} style=${{ fontWeight: 700 }}>${formatRating(groupRow.averageRating)} ★</span> <span class="muted">grp</span></div>`
                    : html`<div class="muted">— grp</div>`
                  }
                  ${e.globalRating != null
                    ? html`<div>${e.globalRating} ★ <span class="muted">global</span></div>`
                    : html`<div class="muted">— global</div>`
                  }
                </div>
              </button>
            `;
          })}
        </div>
      `}
    </div>
  `;
}
