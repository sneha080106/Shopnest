import React from 'react';
import { Link } from 'react-router-dom';

export default function EmptyState({ title, description, actionLabel, actionTo }) {
  return (
    <div style={{ textAlign: 'center', padding: '56px 20px', color: 'var(--color-ink-soft)' }}>
      <h3 style={{ fontSize: 18, marginBottom: 8, color: 'var(--color-ink)' }}>{title}</h3>
      {description && <p style={{ fontSize: 14, marginBottom: 18 }}>{description}</p>}
      {actionLabel && actionTo && (
        <Link to={actionTo} className="btn btn-primary">{actionLabel}</Link>
      )}
    </div>
  );
}
