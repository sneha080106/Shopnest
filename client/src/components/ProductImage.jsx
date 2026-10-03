import React, { useState } from 'react';

// Product images are admin-entered URLs (see README — no upload pipeline), so a broken or
// removed URL is a realistic failure mode, not an edge case. Falls back to an inline SVG
// (no network request, so the fallback itself can't also fail) instead of leaving a broken
// image icon in the layout.
const FALLBACK_SRC = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect width="200" height="200" fill="#eef1f4"/>
    <path d="M60 130 L90 95 L115 120 L135 90 L150 130 Z" fill="#c7cfd6"/>
    <circle cx="75" cy="75" r="12" fill="#c7cfd6"/>
  </svg>
`);

export default function ProductImage({ src, alt, style }) {
  const [errored, setErrored] = useState(false);
  return (
    <img
      src={errored || !src ? FALLBACK_SRC : src}
      alt={alt || ''}
      style={style}
      loading="lazy"
      onError={() => setErrored(true)}
    />
  );
}
