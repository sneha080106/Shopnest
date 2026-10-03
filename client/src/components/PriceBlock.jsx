import React from 'react';

function inr(n) {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

export default function PriceBlock({ price, mrp, discountPercent, size = 'md' }) {
  const big = size === 'lg' ? 22 : 16;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: big, fontWeight: 700, color: '#17222c' }}>{inr(price)}</span>
      {mrp > price && (
        <>
          <span style={{ fontSize: big - 4, color: '#6f7c88', textDecoration: 'line-through' }}>{inr(mrp)}</span>
          <span style={{ fontSize: big - 4, color: '#1f8a57', fontWeight: 600 }}>{discountPercent}% off</span>
        </>
      )}
    </div>
  );
}

export { inr };
