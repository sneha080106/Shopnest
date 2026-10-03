import React from 'react';

export default function ConfirmDialog({ open, title, description, onConfirm, onCancel, confirmLabel = 'Confirm' }) {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(17,24,32,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200
    }} onClick={onCancel}>
      <div
        className="card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        style={{ background: '#fff', padding: 22, maxWidth: 360, width: '90%', boxShadow: 'var(--shadow-md)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 id="confirm-dialog-title" style={{ fontSize: 16, marginBottom: 8 }}>{title}</h3>
        <p style={{ fontSize: 14, color: 'var(--color-ink-soft)', marginBottom: 20 }}>{description}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
