import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api, { getErrorMessage } from '../services/api';
import { useToast } from '../context/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { inr } from '../components/PriceBlock';
import ProductImage from '../components/ProductImage';
import Loader from '../components/Loader';
import { StatusBadge } from './MyOrders';

const PROGRESS_STEPS = ['Placed', 'Confirmed', 'Packed', 'Shipped', 'Delivered'];

export default function OrderDetails() {
  const { id } = useParams();
  const { showToast } = useToast();
  const [order, setOrder] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    api.get(`/orders/${id}`).then(res => setOrder(res.data.order));
  }, [id]);

  async function cancelOrder() {
    if (cancelling) return;
    setCancelling(true);
    try {
      const res = await api.put(`/orders/${id}/cancel`);
      setOrder(res.data.order);
      showToast(res.data.refunded
        ? 'Order cancelled. The payment has been marked as refunded.'
        : 'Order cancelled.');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
      // The order may have moved on (e.g. just shipped): reload so the page shows the truth.
      api.get(`/orders/${id}`).then(res => setOrder(res.data.order)).catch(() => {});
    } finally {
      setCancelling(false);
      setConfirmOpen(false);
    }
  }

  if (!order) return <Loader label="Loading order…" />;

  const isCancelled = order.orderStatus === 'Cancelled';
  const currentIdx = PROGRESS_STEPS.indexOf(order.orderStatus);

  return (
    <div className="container page-wrap" style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 20 }}>Order #{order.orderNumber}</h1>
        <StatusBadge status={order.orderStatus} />
      </div>

      {order.canCancel && (
        <div style={{ marginBottom: 20 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmOpen(true)} disabled={cancelling}>Cancel order</button>
        </div>
      )}

      {!isCancelled && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {PROGRESS_STEPS.map((step, i) => (
              <React.Fragment key={step}>
                <div style={{ textAlign: 'center', flex: i === 0 || i === PROGRESS_STEPS.length - 1 ? '0 0 auto' : 1 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', margin: '0 auto 6px',
                    background: i <= currentIdx ? 'var(--color-primary)' : 'var(--color-border)',
                    color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>{i <= currentIdx ? '✓' : ''}</div>
                  <span style={{ fontSize: 11, color: i <= currentIdx ? 'var(--color-ink)' : 'var(--color-muted)', whiteSpace: 'nowrap' }}>{step}</span>
                </div>
                {i < PROGRESS_STEPS.length - 1 && (
                  <div style={{ flex: 1, height: 2, background: i < currentIdx ? 'var(--color-primary)' : 'var(--color-border)' }} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, marginBottom: 14 }}>Items</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {order.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <ProductImage src={item.image} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 4 }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</p>
                <p style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                  {item.variant ? `${item.variant} · ` : ''}Qty: {item.quantity}
                </p>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{inr(item.price * item.quantity)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div className="card" style={{ padding: 20, flex: '1 1 260px' }}>
          <h2 style={{ fontSize: 15, marginBottom: 10 }}>Delivery</h2>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--color-ink-soft)' }}>
            {order.shippingAddress.fullName}, {order.shippingAddress.phone}<br />
            {order.shippingAddress.houseNumber}, {order.shippingAddress.street}<br />
            {order.shippingAddress.city}, {order.shippingAddress.state} - {order.shippingAddress.pincode}
          </p>
        </div>

        <div className="card" style={{ padding: 20, flex: '1 1 220px' }}>
          <h2 style={{ fontSize: 15, marginBottom: 10 }}>Payment</h2>
          <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>{order.paymentMethod}</p>
          <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>Status: {order.paymentStatus}</p>
        </div>

        <div className="card" style={{ padding: 20, flex: '1 1 220px' }}>
          <h2 style={{ fontSize: 15, marginBottom: 10 }}>Price details</h2>
          <SummaryLine label="Subtotal" value={inr(order.subtotal)} />
          <SummaryLine label="Discount" value={`-${inr(order.discount)}`} />
          <SummaryLine label="Delivery" value={order.deliveryFee === 0 ? 'FREE' : inr(order.deliveryFee)} />
          <SummaryLine label="Total" value={inr(order.total)} bold />
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Cancel this order?"
        description={order.paymentStatus === 'Paid'
          ? 'The items go back into stock and the payment will be marked as refunded. This cannot be undone.'
          : 'The items go back into stock. This cannot be undone.'}
        confirmLabel={cancelling ? 'Cancelling…' : 'Yes, cancel order'}
        onConfirm={cancelOrder}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function SummaryLine({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: bold ? 14 : 13, fontWeight: bold ? 700 : 400, padding: '3px 0' }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
