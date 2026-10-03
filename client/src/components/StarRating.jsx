import React from 'react';

export default function StarRating({ rating = 0, reviewCount, size = 13 }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        background: '#1f8a57', color: '#fff', fontSize: size, fontWeight: 700,
        padding: '1px 6px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 3
      }}>
        {rating.toFixed(1)} ★
      </span>
      {reviewCount != null && (
        <span style={{ fontSize: size, color: '#6f7c88' }}>({reviewCount.toLocaleString('en-IN')})</span>
      )}
    </div>
  );
}
