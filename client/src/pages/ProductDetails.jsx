import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import StarRating from '../components/StarRating';
import PriceBlock from '../components/PriceBlock';
import ProductCard from '../components/ProductCard';
import ProductImage from '../components/ProductImage';
import Loader from '../components/Loader';

function pushRecentlyViewed(slug) {
  try {
    const current = JSON.parse(localStorage.getItem('shopnest_recent')) || [];
    const next = [slug, ...current.filter(s => s !== slug)].slice(0, 10);
    localStorage.setItem('shopnest_recent', JSON.stringify(next));
  } catch { /* ignore */ }
}

export default function ProductDetails() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { addToCart } = useCart();
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [variant, setVariant] = useState(null);
  const [pincode, setPincode] = useState('');
  const [pincodeMsg, setPincodeMsg] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get(`/products/${slug}`).then(res => {
      setData(res.data);
      setActiveImage(0);
      setQuantity(1);
      setVariant(res.data.product.variants?.[0]?.options?.[0] || null);
      pushRecentlyViewed(slug);
    }).finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <Loader label="Loading product…" />;
  if (!data) return null;
  const { product, related } = data;

  function checkPincode() {
    if (!/^\d{6}$/.test(pincode)) {
      setPincodeMsg('Enter a valid 6-digit pincode');
      return;
    }
    setPincodeMsg('Delivery available. Estimated in 4–6 days.');
  }

  async function handleBuyNow() {
    await addToCart(product, quantity, variant);
    navigate('/cart');
  }

  return (
    <div className="container page-wrap">
      <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 16 }}>
        <Link to="/products">Products</Link> / <Link to={`/products?category=${encodeURIComponent(product.category)}`}>{product.category}</Link>
      </div>

      <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', maxWidth: 440 }}>
          <div className="card" style={{ aspectRatio: '1/1', overflow: 'hidden', marginBottom: 10 }}>
            <ProductImage src={product.images[activeImage]} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {product.images.map((img, i) => (
              <button key={i} onClick={() => setActiveImage(i)} className="card" style={{
                width: 64, height: 64, padding: 0, overflow: 'hidden',
                borderColor: activeImage === i ? 'var(--color-primary)' : 'var(--color-border)'
              }}>
                <ProductImage src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: '1 1 360px' }}>
          <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>{product.brand}</span>
          <h1 style={{ fontSize: 22, margin: '4px 0 10px' }}>{product.name}</h1>
          <StarRating rating={product.rating} reviewCount={product.reviewCount} size={14} />
          <div style={{ margin: '14px 0' }}>
            <PriceBlock price={product.price} mrp={product.mrp} discountPercent={product.discountPercent} size="lg" />
            <p style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 4 }}>Inclusive of all taxes</p>
          </div>

          {product.stock > 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-success)', fontWeight: 600, marginBottom: 16 }}>In stock</p>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--color-danger)', fontWeight: 600, marginBottom: 16 }}>Out of stock</p>
          )}

          {product.variants?.map(v => (
            <div key={v.label} style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>{v.label}</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {v.options.map(opt => (
                  <button
                    key={opt}
                    className={`btn btn-sm ${variant === opt ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setVariant(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div style={{ marginBottom: 18 }}>
            <span style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Quantity</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--color-border)', borderRadius: 4 }}>
              <button className="btn btn-ghost btn-sm" aria-label="Decrease quantity" onClick={() => setQuantity(q => Math.max(1, q - 1))}>−</button>
              <span style={{ padding: '0 14px', fontSize: 14 }}>{quantity}</span>
              <button className="btn btn-ghost btn-sm" aria-label="Increase quantity" onClick={() => setQuantity(q => Math.min(product.stock, q + 1))}>+</button>
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <span style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Check delivery availability</span>
            <div style={{ display: 'flex', gap: 8, maxWidth: 260 }}>
              <input value={pincode} onChange={e => setPincode(e.target.value)} placeholder="Enter pincode"
                style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13 }} />
              <button className="btn btn-ghost btn-sm" onClick={checkPincode}>Check</button>
            </div>
            {pincodeMsg && <p style={{ fontSize: 12, color: 'var(--color-ink-soft)', marginTop: 6 }}>{pincodeMsg}</p>}
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-outline btn-block" disabled={product.stock === 0}
              onClick={() => addToCart(product, quantity, variant)}>Add to Cart</button>
            <button className="btn btn-accent btn-block" disabled={product.stock === 0} onClick={handleBuyNow}>Buy Now</button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 48, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 360px' }}>
          <h2 style={{ fontSize: 17, marginBottom: 12 }}>Description</h2>
          <p style={{ fontSize: 14, color: 'var(--color-ink-soft)', lineHeight: 1.6, marginBottom: 24 }}>{product.description}</p>

          {product.highlights?.length > 0 && (
            <>
              <h2 style={{ fontSize: 17, marginBottom: 12 }}>Highlights</h2>
              <ul style={{ fontSize: 14, color: 'var(--color-ink-soft)', lineHeight: 1.9, paddingLeft: 18, marginBottom: 24 }}>
                {product.highlights.map(h => <li key={h}>{h}</li>)}
              </ul>
            </>
          )}
        </div>

        {product.specifications?.length > 0 && (
          <div style={{ flex: '1 1 260px' }}>
            <h2 style={{ fontSize: 17, marginBottom: 12 }}>Specifications</h2>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {product.specifications.map(spec => (
                  <tr key={spec.key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 0', color: 'var(--color-muted)', width: '45%' }}>{spec.key}</td>
                    <td style={{ padding: '8px 0' }}>{spec.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {related?.length > 0 && (
        <div style={{ marginTop: 48 }}>
          <h2 style={{ fontSize: 17, marginBottom: 16 }}>Related products</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {related.map(p => <ProductCard key={p._id} product={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}
