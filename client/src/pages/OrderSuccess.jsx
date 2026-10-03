import React, { useEffect, useState } from 'react';
import { useLocation, useParams, Link } from 'react-router-dom';
import api from '../services/api';
import { inr } from '../components/PriceBlock';
import Loader from '../components/Loader';

export default function OrderSuccess() {
  const { id } = useParams();
  const location = useLocation();
  const [order, setOrder] = useState(null);

  useEffect(() => {
    api.get(`/orders/${id}`).then(res => setOrder(res.data.order));
  }, [id]);

  if (!order) return <Loader label="Loading your order…" />;
  const emailSent = location.state?.emailSent ?? order.emailSent;

  return (
    <div className="container page-wrap" style={{ maxWidth: 560 }}>
      <div className="card" style={{ padding: 32, textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', background: 'var(--color-success-tint)',
          color: 'var(--color-success)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, margin: '0 auto 16px'
        }}>✓</div>
        <h1 style={{ fontSize: 20, marginBottom: 6 }}>Order placed successfully</h1>
        <p style={{ fontSize: 14, color: 'var(--color-ink-soft)', marginBottom: 20 }}>Thank you for your order.</p>

        <div style={{ textAlign: 'left', fontSize: 13, background: 'var(--color-bg)', borderRadius: 6, padding: 16, marginBottom: 20 }}>
          <Row label="Order ID" value={order.orderNumber} />
          <Row label="Total" value={inr(order.total)} />
          <Row label="Payment method" value={order.paymentMethod} />
          <Row label="Delivery address" value={`${order.shippingAddress.city}, ${order.shippingAddress.state} - ${order.shippingAddress.pincode}`} />
          <Row label="Estimated delivery" value={new Date(order.estimatedDelivery).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} />
        </div>

        <p style={{ fontSize: 13, color: emailSent ? 'var(--color-success)' : 'var(--color-muted)', marginBottom: 22 }}>
          {emailSent
            ? 'Order confirmation has been sent to your email.'
            : 'Your order was placed, but we could not confirm email delivery.'}
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to={`/orders/${order._id}`} className="btn btn-primary">View Order</Link>
          <Link to="/products" className="btn btn-ghost">Continue Shopping</Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
