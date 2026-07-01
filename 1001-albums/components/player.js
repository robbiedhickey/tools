import { h, createContext } from 'preact';
import { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'preact/hooks';
import htm from 'htm';
import { useMusicService, useEmbeddablePlayers } from '../lib/settings.js';

const html = htm.bind(h);

export function MusicServicePreferencePicker({ musicService }) {
  if (!musicService) return null;
  return html`
    <div class="theme-picker" role="group" aria-label="Music service">
      <button
        type="button"
        class=${`theme-option ${musicService.preference === 'apple' ? 'active' : ''}`}
        onClick=${() => musicService.setPreference('apple')}
        aria-pressed=${musicService.preference === 'apple'}
      ><span class="icon-symbol">music_note</span> Apple</button>
      <button
        type="button"
        class=${`theme-option ${musicService.preference === 'spotify' ? 'active' : ''}`}
        onClick=${() => musicService.setPreference('spotify')}
        aria-pressed=${musicService.preference === 'spotify'}
      ><span class="icon-symbol">graphic_eq</span> Spotify</button>
    </div>
  `;
}

export function appleMusicEmbedUrl(track) {
  const url = track?.trackViewUrl || '';
  if (!track?.appleTrackId || !url.includes('music.apple.com/')) return null;
  try {
    const parsed = new URL(url);
    parsed.hostname = 'embed.music.apple.com';
    if (!parsed.searchParams.get('i')) parsed.searchParams.set('i', track.appleTrackId);
    parsed.searchParams.set('autoplay', '1');
    return parsed.toString();
  } catch {
    return null;
  }
}

export function spotifyEmbedUrl(track) {
  return track?.spotifyTrackId ? `https://open.spotify.com/embed/track/${encodeURIComponent(track.spotifyTrackId)}` : null;
}

export function spotifyTrackUrl(track) {
  return track?.spotifyTrackId ? `https://open.spotify.com/track/${encodeURIComponent(track.spotifyTrackId)}` : null;
}

export function appleMusicAlbumEmbedUrl(album) {
  if (!album?.appleMusicId) return null;
  return `https://embed.music.apple.com/us/album/${encodeURIComponent(album.appleMusicId)}`;
}

export function spotifyAlbumEmbedUrl(album) {
  return album?.spotifyId ? `https://open.spotify.com/embed/album/${encodeURIComponent(album.spotifyId)}` : null;
}

export function albumEmbed(album, preferredService = 'spotify') {
  const appleUrl = appleMusicAlbumEmbedUrl(album);
  const spotifyUrl = spotifyAlbumEmbedUrl(album);
  const embeds = {
    apple: appleUrl ? {
      service: 'Apple Music',
      key: 'apple',
      url: appleUrl,
      openUrl: album.appleMusicId ? `https://music.apple.com/album/${encodeURIComponent(album.appleMusicId)}` : appleUrl,
    } : null,
    spotify: spotifyUrl ? {
      service: 'Spotify',
      key: 'spotify',
      url: spotifyUrl,
      openUrl: album.spotifyId ? `https://open.spotify.com/album/${encodeURIComponent(album.spotifyId)}` : spotifyUrl,
    } : null,
  };
  return embeds[preferredService] || embeds.apple || embeds.spotify || null;
}

export function albumAvailableEmbeds(album) {
  return {
    apple: albumEmbed(album, 'apple'),
    spotify: albumEmbed(album, 'spotify'),
  };
}

let spotifyIframeApi = null;
let spotifyIframeApiPromise = null;
export function loadSpotifyIframeApi() {
  if (spotifyIframeApi) return Promise.resolve(spotifyIframeApi);
  if (!spotifyIframeApiPromise) {
    spotifyIframeApiPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="https://open.spotify.com/embed/iframe-api/v1"]');
      const previousReady = window.onSpotifyIframeApiReady;
      window.onSpotifyIframeApiReady = (api) => {
        spotifyIframeApi = api;
        if (typeof previousReady === 'function') previousReady(api);
        resolve(api);
      };
      if (!existing) {
        const script = document.createElement('script');
        script.src = 'https://open.spotify.com/embed/iframe-api/v1';
        script.async = true;
        script.onerror = () => reject(new Error('Spotify player API failed to load'));
        document.body.appendChild(script);
      }
    });
  }
  return spotifyIframeApiPromise;
}

export function trackEmbed(track, preferredService = 'spotify') {
  const appleUrl = appleMusicEmbedUrl(track);
  const spotifyUrl = spotifyEmbedUrl(track);
  const embeds = {
    apple: appleUrl ? { service: 'Apple Music', key: 'apple', url: appleUrl, openUrl: track.trackViewUrl || appleUrl } : null,
    spotify: spotifyUrl ? { service: 'Spotify', key: 'spotify', url: spotifyUrl, openUrl: spotifyTrackUrl(track) || spotifyUrl } : null,
  };
  return embeds[preferredService] || embeds.apple || embeds.spotify || null;
}


export const AlbumPlayerContext = createContext({
  player: null,
  openPlayer: () => {},
  closePlayer: () => {},
  setPlayerService: () => {},
  togglePlayerExpanded: () => {},
});

export function useAlbumPlayer() {
  return useContext(AlbumPlayerContext);
}

export function AlbumPlayerProvider({ musicService, children }) {
  const [player, setPlayer] = useState(null);

  const openPlayer = useCallback((album, service = musicService.preference) => {
    const embed = albumEmbed(album, service);
    if (!embed) return;
    setPlayer({
      album,
      service: embed.key,
      embed,
      expanded: true,
    });
  }, [musicService.preference]);

  const closePlayer = useCallback(() => setPlayer(null), []);
  const setPlayerService = useCallback((service) => {
    setPlayer(current => {
      if (!current) return current;
      const embed = albumEmbed(current.album, service);
      if (!embed) return current;
      return { ...current, service: embed.key, embed };
    });
  }, []);
  const togglePlayerExpanded = useCallback(() => {
    setPlayer(current => current ? { ...current, expanded: !current.expanded } : current);
  }, []);

  const value = useMemo(() => ({ player, openPlayer, closePlayer, setPlayerService, togglePlayerExpanded }), [player, openPlayer, closePlayer, setPlayerService, togglePlayerExpanded]);
  return html`<${AlbumPlayerContext.Provider} value=${value}>${children}<//>`;
}

export function AlbumPlayButton({ album, service = null, label = 'Play album' }) {
  const musicService = useMusicService();
  const players = useEmbeddablePlayers();
  const player = useAlbumPlayer();
  if (!players.enabled) return null;
  const embed = albumEmbed(album, service || musicService.preference);
  return html`
    <button
      type="button"
      class="album-play-btn"
      disabled=${!embed}
      aria-label=${embed ? `${label} with ${embed.service}` : 'No album player available'}
      title=${embed ? `${label} with ${embed.service}` : 'No album player available'}
      onClick=${() => embed && player.openPlayer(album, embed.key)}
    ><span class="icon-symbol">play_arrow</span></button>
  `;
}

export function SpotifyAlbumControllerEmbed({ album, onController, onPlaybackUpdate }) {
  const hostRef = useRef(null);

  useEffect(() => {
    if (!album?.spotifyId || !hostRef.current) return;
    let cancelled = false;
    let controller = null;
    hostRef.current.innerHTML = '';
    onController(null);

    loadSpotifyIframeApi()
      .then((api) => {
        if (cancelled || !hostRef.current) return;
        api.createController(
          hostRef.current,
          {
            uri: `spotify:album:${album.spotifyId}`,
            width: '100%',
            height: '352',
          },
          (createdController) => {
            if (cancelled) {
              createdController.destroy();
              return;
            }
            controller = createdController;
            onController(createdController);
            createdController.addListener('playback_update', (event) => onPlaybackUpdate(event.data || null));
            createdController.addListener('playback_started', (event) => onPlaybackUpdate(event.data || null));
          }
        );
      })
      .catch(() => onController(null));

    return () => {
      cancelled = true;
      onController(null);
      if (controller) controller.destroy();
    };
  }, [album?.spotifyId]);

  return html`<div class="spotify-api-frame" ref=${hostRef}></div>`;
}

export function AlbumPlayerDock() {
  const { player, closePlayer, setPlayerService, togglePlayerExpanded } = useAlbumPlayer();
  const [spotifyController, setSpotifyController] = useState(null);
  const [spotifyPaused, setSpotifyPaused] = useState(true);
  if (!player) return null;
  const album = player.album;
  const available = albumAvailableEmbeds(album);
  const art = album.images?.[0]?.url || album.images?.[1]?.url || '';
  const controlsEnabled = player.service === 'spotify' && spotifyController;
  const toggleSpotify = () => {
    if (!spotifyController) return;
    spotifyController.togglePlay();
  };
  return html`
    <section class=${`player-dock ${player.expanded ? '' : 'minimized'}`} aria-label="Album player">
      <div class="player-dock-head">
        ${art
          ? html`<img class="player-dock-art" src=${art} alt="" loading="lazy" decoding="async" />`
          : html`<div class="player-dock-art" />`}
        <div style=${{ minWidth: 0 }}>
          <div class="player-dock-title">${album.name}</div>
          <div class="player-dock-artist">${album.artist}${player.embed?.service ? ` · ${player.embed.service}` : ''}</div>
        </div>
        <div class="player-dock-actions">
          ${player.service === 'spotify' && html`
            <div class="player-transport">
              <button
                type="button"
                class="player-dock-action primary"
                disabled=${!controlsEnabled}
                onClick=${toggleSpotify}
                title="Play or pause Spotify"
                aria-label=${spotifyPaused ? 'Play' : 'Pause'}
              >
                <span class="icon-symbol">${spotifyPaused ? 'play_arrow' : 'pause'}</span>
              </button>
            </div>
          `}
          ${(available.apple && available.spotify) && html`
            <div class="player-service-toggle" aria-label="Player service">
              <button type="button" class=${player.service === 'apple' ? 'active' : ''} onClick=${() => setPlayerService('apple')}>Apple</button>
              <button type="button" class=${player.service === 'spotify' ? 'active' : ''} onClick=${() => setPlayerService('spotify')}>Spotify</button>
            </div>
          `}
          <a class="player-dock-action" href=${player.embed.openUrl} target="_blank" rel="noopener" title="Open in service" aria-label="Open in service">
            <span class="icon-symbol">open_in_new</span>
          </a>
          <button type="button" class="player-dock-action" onClick=${togglePlayerExpanded} aria-label=${player.expanded ? 'Minimize player' : 'Expand player'} title=${player.expanded ? 'Minimize player' : 'Expand player'}>
            <span class="icon-symbol">${player.expanded ? 'keyboard_arrow_down' : 'keyboard_arrow_up'}</span>
          </button>
          <button type="button" class="player-dock-action" onClick=${closePlayer} aria-label="Close player" title="Close player">
            <span class="icon-symbol">close</span>
          </button>
        </div>
      </div>
      <div class="player-dock-body" aria-hidden=${!player.expanded}>
        ${player.service === 'spotify'
          ? html`<${SpotifyAlbumControllerEmbed}
              album=${album}
              onController=${setSpotifyController}
              onPlaybackUpdate=${(data) => {
                if (typeof data?.isPaused === 'boolean') setSpotifyPaused(data.isPaused);
              }}
            />`
          : html`
            <iframe
              class="player-dock-frame"
              src=${player.embed.url}
              title=${`${album.name} on ${player.embed.service}`}
              allow="autoplay *; clipboard-write *; encrypted-media *; fullscreen *; picture-in-picture *"
            ></iframe>
          `}
      </div>
    </section>
  `;
}
