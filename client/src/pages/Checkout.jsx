import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import AddressForm from '../components/AddressForm';
import { inr } from '../components/PriceBlock';
import EmptyState from '../components/EmptyState';

const STEPS = ['Address', 'Summary', 'Payment'];

export default function Checkout() {
  const { user, updateUserAddresses } = useAuth();
  const { cart, refreshCart } = useCart();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [selectedAddressId, setSelectedAddressId] = useState(
    user.addresses.find(a => a.isDefault)?._id || user.addresses[0]?._id || null
  );
  const [addingAddress, setAddingAddress] = useState(user.addresses.length === 0);
  const [paymentMethod, setPaymentMethod] = useState('Demo UPI');
  const [upiId, setUpiId] = useState('');
  const [card, setCard] = useState({ name: '', number: '', expiry: '', cvv: '' });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  // One id per checkout attempt (not per click) — a retried submit after a network hiccup
  // reuses it, so the backend can recognize the retry and return the original order instead
  // of creating a second one. crypto.randomUUID() is available in every browser we target.
  const clientRequestIdRef = useRef(crypto.randomUUID());

  if (cart.items.length === 0) {
    return (
      <div className="container page-wrap">
        <EmptyState title="Your cart is empty" description="Add items to your cart before checking out." actionLabel="Browse products" actionTo="/products" />
      </div>
    );
  }

  async function handleAddAddress(data) {
    try {
      const res = await api.post('/addresses', data);
      updateUserAddresses(res.data.addresses);
      const newest = res.data.addresses[res.data.addresses.length - 1];
      setSelectedAddressId(newest._id);
      setAddingAddress(false);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  }

  async function placeOrder() {
    if (processing) return; // guards against a fast double-click/double-tap slipping past disabled state
    setError('');
    setProcessing(true);
    try {
      let transactionId;
      if (paymentMethod !== 'Cash on Delivery') {
        const payRes = await api.post('/payment/demo', {
          method: paymentMethod,
          upiId: paymentMethod === 'Demo UPI' ? upiId : undefined,
          card: paymentMethod === 'Demo Card' ? card : undefined,
          // Same id as the order request, so a retried checkout reuses the payment it already made.
          clientRequestId: clientRequestIdRef.current
        });
        transactionId = payRes.data.transactionId;
      }
      const orderRes = await api.post('/orders', {
        addressId: selectedAddressId,
        paymentMethod,
        transactionId,
        clientRequestId: clientRequestIdRef.current,
        expectedTotal: cart.total
      });
      await refreshCart();
      navigate(`/order-success/${orderRes.data.order._id}`, { state: { emailSent: orderRes.data.emailSent } });
    } catch (err) {
      if (err.response?.status === 409) {
        // Prices/stock moved under us since the cart was last shown — refresh it and send the
        // user back to review rather than silently placing an order at the wrong total.
        await refreshCart();
        showToast('Some items in your cart have changed. Please review your cart before placing the order.', 'error');
        setStep(1);
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="container page-wrap" style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 20, marginBottom: 6 }}>Checkout</h1>
      <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <span style={{
              fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 12,
              background: i === step ? 'var(--color-primary)' : i < step ? 'var(--color-success-tint)' : 'var(--color-bg)',
              color: i === step ? '#fff' : i < step ? 'var(--color-success)' : 'var(--color-muted)',
              border: i === step ? 'none' : '1px solid var(--color-border)'
            }}>{i + 1}. {s}</span>
          </React.Fragment>
        ))}
      </div>

      {step === 0 && (
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 15, marginBottom: 14 }}>Select a delivery address</h2>
          {!addingAddress && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {user.addresses.map(addr => (
                <label key={addr._id} className="card" style={{
                  display: 'flex', gap: 10, padding: 14, cursor: 'pointer',
                  borderColor: selectedAddressId === addr._id ? 'var(--color-primary)' : 'var(--color-border)'
                }}>
                  <input type="radio" name="address" checked={selectedAddressId === addr._id} onChange={() => setSelectedAddressId(addr._id)} />
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary)' }}>{addr.type}</span>
                    <p style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{addr.fullName} · {addr.phone}</p>
                    <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>{addr.houseNumber}, {addr.street}, {addr.city}, {addr.state} - {addr.pincode}</p>
                  </div>
                </label>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAddingAddress(true)}>+ Add a new address</button>
            </div>
          )}
          {addingAddress && (
            <div style={{ marginBottom: 16 }}>
              <AddressForm onSubmit={handleAddAddress} onCancel={user.addresses.length > 0 ? () => setAddingAddress(false) : undefined} />
            </div>
          )}
          <button className="btn btn-primary" disabled={!selectedAddressId} onClick={() => setStep(1)}>Continue</button>
        </div>
      )}

      {step === 1 && (
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 15, marginBottom: 14 }}>Order summary</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {cart.items.map(item => (
              <div key={item._id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>{item.product.name} {item.variant ? `(${item.variant})` : ''} × {item.quantity}</span>
                <span style={{ fontWeight: 600 }}>{inr(item.product.price * item.quantity)}</span>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
            <SummaryLine label="Subtotal" value={inr(cart.subtotal)} />
            <SummaryLine label="Discount" value={`-${inr(cart.discount)}`} />
            <SummaryLine label="Delivery" value={cart.deliveryFee === 0 ? 'FREE' : inr(cart.deliveryFee)} />
            <SummaryLine label="Total" value={inr(cart.total)} bold />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setStep(0)}>Back</button>
            <button className="btn btn-primary" onClick={() => setStep(2)}>Continue to payment</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 15, marginBottom: 4 }}>Payment</h2>
          <p style={{
            fontSize: 12, fontWeight: 700, color: 'var(--color-accent-dark)', background: '#fdf3dd',
            display: 'inline-block', padding: '4px 10px', borderRadius: 4, margin: '8px 0 16px'
          }}>
            DEMO PAYMENT — NO REAL MONEY WILL BE CHARGED
          </p>

          <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
            {['Demo UPI', 'Demo Card', 'Cash on Delivery'].map(method => (
              <button key={method} className={`btn btn-sm ${paymentMethod === method ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPaymentMethod(method)}>
                {method}
              </button>
            ))}
          </div>

          {paymentMethod === 'Demo UPI' && (
            <div className="field" style={{ maxWidth: 300 }}>
              <label>UPI ID</label>
              <input placeholder="yourname@upi" value={upiId} onChange={e => setUpiId(e.target.value)} />
            </div>
          )}

          {paymentMethod === 'Demo Card' && (
            <div style={{ maxWidth: 360 }}>
              <div className="field">
                <label>Cardholder name</label>
                <input value={card.name} onChange={e => setCard({ ...card, name: e.target.value })} />
              </div>
              <div className="field">
                <label>Card number</label>
                <input placeholder="4111 1111 1111 1111" value={card.number} onChange={e => setCard({ ...card, number: e.target.value })} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Expiry</label>
                  <input placeholder="12/30" value={card.expiry} onChange={e => setCard({ ...card, expiry: e.target.value })} />
                </div>
                <div className="field">
                  <label>CVV</label>
                  <input placeholder="123" value={card.cvv} onChange={e => setCard({ ...card, cvv: e.target.value })} />
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-muted)' }}>Use the demo card number above — no real card details are accepted.</p>
            </div>
          )}

          {paymentMethod === 'Cash on Delivery' && (
            <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginBottom: 10 }}>Pay in cash when your order is delivered.</p>
          )}

          {error && <p className="field-error" style={{ marginTop: 12 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)} disabled={processing}>Back</button>
            <button className="btn btn-accent" onClick={placeOrder} disabled={processing}>
              {processing ? 'Processing payment…' : `Pay & Place Order · ${inr(cart.total)}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryLine({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: bold ? 15 : 13, fontWeight: bold ? 700 : 400, padding: '3px 0' }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
