import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { inr } from '../components/PriceBlock';
import Loader from '../components/Loader';
import ProductImage from '../components/ProductImage';

export default function Cart() {
  const { cart, loading, updateQuantity, removeItem } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [confirmId, setConfirmId] = useState(null);

  if (loading) return <Loader label="Loading your cart…" />;

  if (cart.items.length === 0) {
    return (
      <div className="container page-wrap">
        <EmptyState title="Nothing in your cart yet" description="Browse products and add something you like." actionLabel="Continue shopping" actionTo="/products" />
      </div>
    );
  }

  return (
    <div className="container page-wrap">
      <h1 style={{ fontSize: 20, marginBottom: 20 }}>Your Cart</h1>
      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 420px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cart.items.map(item => (
            <div key={item._id} className="card" style={{ display: 'flex', gap: 14, padding: 14 }}>
              <Link to={`/product/${item.product.slug}`} style={{ width: 84, height: 84, flexShrink: 0, background: '#f6f7f9', borderRadius: 4, overflow: 'hidden' }}>
                <ProductImage src={item.product.images?.[0]} alt={item.product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </Link>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link to={`/product/${item.product.slug}`}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{item.product.name}</h3>
                </Link>
                {item.variant && <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{item.variant}</span>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--color-border)', borderRadius: 4 }}>
                    <button className="btn btn-ghost btn-sm" aria-label="Decrease quantity" onClick={() => updateQuantity(item._id, Math.max(1, item.quantity - 1))}>−</button>
                    <span style={{ padding: '0 12px', fontSize: 13 }}>{item.quantity}</span>
                    <button className="btn btn-ghost btn-sm" aria-label="Increase quantity" onClick={() => updateQuantity(item._id, Math.min(item.product.stock, item.quantity + 1))}>+</button>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmId(item._id)}>Remove</button>
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>
                {inr(item.product.price * item.quantity)}
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ flex: '1 1 280px', padding: 18, position: 'sticky', top: 100 }}>
          <h2 style={{ fontSize: 15, marginBottom: 14 }}>Order summary</h2>
          <SummaryRow label="Subtotal" value={inr(cart.subtotal)} />
          <SummaryRow label="Discount" value={`-${inr(cart.discount)}`} valueColor="var(--color-success)" />
          <SummaryRow label="Delivery" value={cart.deliveryFee === 0 ? 'FREE' : inr(cart.deliveryFee)} valueColor={cart.deliveryFee === 0 ? 'var(--color-success)' : undefined} />
          <div style={{ borderTop: '1px solid var(--color-border)', margin: '10px 0' }} />
          <SummaryRow label="Total" value={inr(cart.total)} bold />
          <button
            className="btn btn-accent btn-block"
            style={{ marginTop: 16 }}
            onClick={() => user ? navigate('/checkout') : navigate('/login', { state: { from: { pathname: '/checkout' } } })}
          >
            Proceed to Checkout
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmId}
        title="Remove item?"
        description="This item will be removed from your cart."
        confirmLabel="Remove"
        onCancel={() => setConfirmId(null)}
        onConfirm={() => { removeItem(confirmId); setConfirmId(null); }}
      />
    </div>
  );
}

function SummaryRow({ label, value, bold, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: bold ? 15 : 13, fontWeight: bold ? 700 : 400, padding: '4px 0', color: 'var(--color-ink-soft)' }}>
      <span style={{ color: bold ? 'var(--color-ink)' : 'inherit' }}>{label}</span>
      <span style={{ color: valueColor || (bold ? 'var(--color-ink)' : 'inherit') }}>{value}</span>
    </div>
  );
}
