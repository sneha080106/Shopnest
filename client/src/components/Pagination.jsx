import React from 'react';

export default function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    p => p === 1 || p === totalPages || Math.abs(p - page) <= 1
  );

  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 28, flexWrap: 'wrap' }}>
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
      {pages.map((p, idx) => (
        <React.Fragment key={p}>
          {idx > 0 && pages[idx - 1] !== p - 1 && <span style={{ alignSelf: 'center', color: 'var(--color-muted)' }}>…</span>}
          <button
            className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        </React.Fragment>
      ))}
      <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}
