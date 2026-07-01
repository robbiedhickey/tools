import { h, Fragment } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { STREAMING_ICONS, PRIMARY_STREAMING_SERVICES, LANKY_GIF_URL, LANKY_LOADING_GIF_URL } from '../lib/constants.js';
import { streamingLinks, modalFrameUrl } from '../lib/format.js';

const html = htm.bind(h);

// ---------- small components ----------
export function StreamingServiceIcon({ service, url }) {
  const iconFn = STREAMING_ICONS[service];
  if (!iconFn) return html`<a class="link-chip" href=${url} target="_blank" rel="noopener">${service}</a>`;
  return html`
    <a
      href=${url}
      target="_blank"
      rel="noopener"
      title=${service}
      class="streaming-icon-btn"
      dangerouslySetInnerHTML=${{ __html: iconFn(service === 'YouTube Music' ? 44 : 36) }}
    />
  `;
}

export function StreamingLinks({ album, extraLinks = [] }) {
  const base = streamingLinks(album).filter(l => PRIMARY_STREAMING_SERVICES.includes(l.service));
  const seen = new Set(base.map(l => l.service));
  const extra = extraLinks.filter(l => PRIMARY_STREAMING_SERVICES.includes(l.service) && !seen.has(l.service));
  const links = [...base, ...extra];
  if (!links.length) return null;
  return html`
    <div class="streaming-icons-col">
      ${links.map(l => html`<${StreamingServiceIcon} service=${l.service} url=${l.url} />`)}
    </div>
  `;
}

export function SiteModal({ url, title, onClose }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const frameUrl = modalFrameUrl(url);

  return html`
    <div class="modal-backdrop" role="presentation" onClick=${onClose}>
      <div class="modal" role="dialog" aria-modal="true" aria-label=${title} onClick=${(event) => event.stopPropagation()}>
        <div class="modal-header">
          <div class="modal-title">${title}</div>
          <div class="modal-actions">
            <a class="link-chip" href=${url} target="_blank" rel="noopener">Open in new tab</a>
            <button class="modal-close" type="button" aria-label="Close" onClick=${onClose}>×</button>
          </div>
        </div>
        <div class="modal-frame-wrap">
          <iframe src=${frameUrl} title=${title}></iframe>
        </div>
      </div>
    </div>
  `;
}

export function SiteModalLink({ href, title, children, className = '' }) {
  const [open, setOpen] = useState(false);
  return html`
    <${Fragment}>
      <a class=${className} href=${href} onClick=${(event) => { event.preventDefault(); setOpen(true); }}>${children}</a>
      ${open && html`<${SiteModal} url=${href} title=${title} onClose=${() => setOpen(false)} />`}
    <//>
  `;
}

export function Loading() {
  return html`
    <div class="card center muted">
      <img class="lanky-loader" src=${LANKY_LOADING_GIF_URL} alt="" aria-hidden="true" />
      <div>Lanky's fetching your albums…</div>
    </div>
  `;
}

export function LoadingNote({ label, className = 'muted' }) {
  return html`<p class=${className}><${LankyPartyMascot} />${label}</p>`;
}

// Official Apple Music glyph (Simple Icons, single-color path), used as a compact icon-only
// link instead of a text pill to save horizontal space in dense rows.
export function AppleMusicIcon({ size = 16 }) {
  return html`
    <svg viewBox="0 0 24 24" width=${size} height=${size} fill="currentColor" aria-hidden="true">
      <path d="M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 00-1.877-.726 10.496 10.496 0 00-1.564-.15c-.04-.003-.083-.01-.124-.013H5.986c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408-.056.392-.088.785-.1 1.18 0 .032-.007.062-.01.093v12.223c.01.14.017.283.027.424.05.815.154 1.624.497 2.373.65 1.42 1.738 2.353 3.234 2.801.42.127.856.187 1.293.228.555.053 1.11.06 1.667.06h11.03a12.5 12.5 0 001.57-.1c.822-.106 1.596-.35 2.295-.81a5.046 5.046 0 001.88-2.207c.186-.42.293-.87.37-1.324.113-.675.138-1.358.137-2.04-.002-3.8 0-7.595-.003-11.393zm-6.423 3.99v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.157-1.07.173-.95.045-1.773-.6-1.943-1.536a1.88 1.88 0 011.038-2.022c.323-.16.67-.25 1.018-.324.378-.082.758-.153 1.134-.24.274-.063.457-.23.51-.516a.904.904 0 00.02-.193c0-1.815 0-3.63-.002-5.443a.725.725 0 00-.026-.185c-.04-.15-.15-.243-.304-.234-.16.01-.318.035-.475.066-.76.15-1.52.303-2.28.456l-2.325.47-1.374.278c-.016.003-.032.01-.048.013-.277.077-.377.203-.39.49-.002.042 0 .086 0 .13-.002 2.602 0 5.204-.003 7.805 0 .42-.047.836-.215 1.227-.278.64-.77 1.04-1.434 1.233-.35.1-.71.16-1.075.172-.96.036-1.755-.6-1.92-1.544-.14-.812.23-1.685 1.154-2.075.357-.15.73-.232 1.108-.31.287-.06.575-.116.86-.177.383-.083.583-.323.6-.714v-.15c0-2.96 0-5.922.002-8.882 0-.123.013-.25.042-.37.07-.285.273-.448.546-.518.255-.066.515-.112.774-.165.733-.15 1.466-.296 2.2-.444l2.27-.46c.67-.134 1.34-.27 2.01-.403.22-.043.442-.088.663-.106.31-.025.523.17.554.482.008.073.012.148.012.223.002 1.91.002 3.822 0 5.732z"/>
    </svg>
  `;
}

export function LankyMascot({ className = '' }) {
  return html`<img class=${`mascot ${className}`} src=${LANKY_GIF_URL} alt="" aria-hidden="true" />`;
}

export function LankyPartyMascot({ className = '' }) {
  return html`<img class=${`mascot ${className}`} src=${LANKY_LOADING_GIF_URL} alt="" aria-hidden="true" />`;
}

export function Splash({ ready, refreshing }) {
  if (ready) return null;
  return html`
    <div class="splash" role="status" aria-live="polite">
      <img class="splash-gif" src=${LANKY_LOADING_GIF_URL} alt="" aria-hidden="true" />
      <div class="splash-label">${refreshing ? 'Getting your latest albums…' : 'Loading your albums…'}</div>
    </div>
  `;
}

export function ErrorCard({ error, projectName, onRetry }) {
  return html`
    <div class="card">
      <p>${error && error.status === 404 ? `Couldn't find a project named "${projectName}". Check the spelling?` : `Something went wrong: ${error && error.message}`}</p>
      <button class="pill-btn" onClick=${onRetry}>Try again</button>
    </div>
  `;
}

export function RefreshErrorToast({ error, onDismiss }) {
  if (!error) return null;
  return html`
    <div class="toast" role="status" aria-live="polite">
      <div>
        <div class="toast-title">Refresh failed</div>
        <div class="toast-body">${error.message || 'Cached data is still being shown.'}</div>
      </div>
      <button class="toast-close" type="button" aria-label="Dismiss refresh error" onClick=${onDismiss}>×</button>
    </div>
  `;
}
