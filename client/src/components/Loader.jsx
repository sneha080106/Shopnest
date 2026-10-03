import React from 'react';

export function GridSkeleton({ count = 8 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ overflow: 'hidden' }}>
          <div className="skeleton" style={{ aspectRatio: '1/1' }} />
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 12, width: '60%' }} />
            <div className="skeleton" style={{ height: 14, width: '90%' }} />
            <div className="skeleton" style={{ height: 14, width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Loader({ label = 'Loading…' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--color-muted)', fontSize: 14 }}>
      {label}
    </div>
  );
}
