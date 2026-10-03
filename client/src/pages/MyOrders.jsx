import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { inr } from '../components/PriceBlock';
import ProductImage from '../components/ProductImage';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';

export default function MyOrders() {
  const [orders, setOrders] = useState(null);

  useEffect(() => {
    api.get('/orders').then(res => setOrders(res.data.orders));
  }, []);

  if (!orders) return <Loader label="Loading your orders…" />;

  if (orders.length === 0) {
    return (
      <div className="container page-wrap">
        <EmptyState title="No orders yet" description="Your order history will show up here." actionLabel="Start shopping" actionTo="/products" />
      </div>
    );
  }

  return (
    <div className="container page-wrap" style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 20, marginBottom: 20 }}>My Orders</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {orders.map(order => (
          <Link key={order._id} to={`/orders/${order._id}`} className="card" style={{ display: 'flex', gap: 14, padding: 16, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {order.items.slice(0, 3).map((item, i) => (
                <ProductImage key={i} src={item.image} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }} />
              ))}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600 }}>Order #{order.orderNumber}</p>
              <p style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {order.items.length} item(s)
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 14, fontWeight: 700 }}>{inr(order.total)}</p>
              <StatusBadge status={order.orderStatus} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  const colors = {
    Placed: ['#fdf3dd', '#b17f03'],
    Confirmed: ['#e8eef3', '#123c5c'],
    Packed: ['#e8eef3', '#123c5c'],
    Shipped: ['#e8eef3', '#123c5c'],
    'Out for Delivery': ['#e8eef3', '#123c5c'],
    Delivered: ['#e7f5ee', '#1f8a57'],
    Cancelled: ['#fbeae8', '#c0392b']
  };
  const [bg, fg] = colors[status] || ['#eee', '#333'];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, background: bg, color: fg, padding: '2px 8px', borderRadius: 10 }}>{status}</span>
  );
}
