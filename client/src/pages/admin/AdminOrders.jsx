import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { inr } from '../../components/PriceBlock';
import Loader from '../../components/Loader';

const STATUSES = ['Awaiting Payment', 'Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Expired'];

export default function AdminOrders() {
  const { showToast } = useToast();
  const [orders, setOrders] = useState(null);
  const [filter, setFilter] = useState('');

  async function load() {
    const res = await api.get(`/admin/orders?limit=100${filter ? `&status=${filter}` : ''}`);
    setOrders(res.data.orders);
  }

  useEffect(() => { load(); }, [filter]);

  async function updateStatus(id, orderStatus) {
    try {
      await api.put(`/admin/orders/${id}/status`, { orderStatus });
      showToast('Order status updated');
      load();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  }

  if (!orders) return <Loader label="Loading orders…" />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13 }}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--color-bg)', textAlign: 'left' }}>
              <Th>Order</Th><Th>Customer</Th><Th>Total</Th><Th>Payment</Th><Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o._id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <Td>
                  <div>#{o.orderNumber}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                    {new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </div>
                </Td>
                <Td>{o.user?.name}<div style={{ fontSize: 11, color: 'var(--color-muted)' }}>{o.user?.email}</div></Td>
                <Td>{inr(o.total)}</Td>
                <Td>{o.paymentMethod}<div style={{ fontSize: 11, color: 'var(--color-muted)' }}>{o.paymentStatus}</div></Td>
                <Td>
                  {/* Only the current status and the steps the server will accept are offered. */}
                  <select value={o.orderStatus} onChange={e => updateStatus(o._id, e.target.value)}
                    disabled={!o.nextStatuses || o.nextStatuses.length === 0}
                    aria-label={`Status of order ${o.orderNumber}`}
                    style={{ padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 12 }}>
                    {[o.orderStatus, ...(o.nextStatuses || [])].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && <p style={{ padding: 20, fontSize: 13, color: 'var(--color-muted)' }}>No orders found.</p>}
      </div>
    </div>
  );
}

function Th({ children }) { return <th style={{ padding: '10px 12px', fontWeight: 600 }}>{children}</th>; }
function Td({ children }) { return <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>{children}</td>; }
