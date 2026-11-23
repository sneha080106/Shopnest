import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import ProductCard from '../components/ProductCard';
import { GridSkeleton } from '../components/Loader';

const CATEGORY_TILES = [
  { name: 'Electronics', img: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=300&q=80' },
  { name: 'Mobiles', img: 'https://images.unsplash.com/photo-1592890288564-76628a30a657?auto=format&fit=crop&w=300&q=80' },
  { name: 'Fashion', img: 'https://images.unsplash.com/photo-1573612664822-d7d347da7b80?auto=format&fit=crop&w=300&q=80' },
  { name: 'Home & Kitchen', img: 'https://images.unsplash.com/photo-1556910602-38f53e68e15d?auto=format&fit=crop&w=300&q=80' },
  { name: 'Beauty', img: 'https://images.unsplash.com/photo-1552046122-03184de85e08?auto=format&fit=crop&w=300&q=80' },
  { name: 'Books', img: 'https://images.unsplash.com/photo-1695773719016-3d033a4aac07?auto=format&fit=crop&w=300&q=80' },
  { name: 'Sports', img: 'https://images.unsplash.com/photo-1646239646963-b0b9be56d6b5?auto=format&fit=crop&w=300&q=80' },
  { name: 'Accessories', img: 'https://images.unsplash.com/photo-1518665750801-883c188a660d?auto=format&fit=crop&w=300&q=80' }
];

function useRecentlyViewed() {
  const [ids, setIds] = useState([]);
  useEffect(() => {
    try {
      setIds(JSON.parse(localStorage.getItem('shopnest_recent')) || []);
    } catch { setIds([]); }
  }, []);
  return ids;
}

export default function Home() {
  const [featured, setFeatured] = useState([]);
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const recentSlugs = useRecentlyViewed();
  const [recentProducts, setRecentProducts] = useState([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [featRes, dealsRes] = await Promise.all([
        api.get('/products?sort=rating&limit=8'),
        api.get('/products?sort=newest&limit=6')
      ]);
      setFeatured(featRes.data.products);
      setDeals(dealsRes.data.products.filter(p => p.discountPercent >= 20).slice(0, 6));
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    async function loadRecent() {
      if (recentSlugs.length === 0) return;
      const results = await Promise.all(
        recentSlugs.slice(0, 6).map(slug => api.get(`/products/${slug}`).then(r => r.data.product).catch(() => null))
      );
      setRecentProducts(results.filter(Boolean));
    }
    loadRecent();
  }, [recentSlugs]);

  return (
    <div>
      <section style={{ background: 'linear-gradient(135deg, #123c5c, #1b527a)', color: '#fff' }}>
        <div className="container" style={{ padding: '56px 20px', display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <h1 style={{ fontSize: 36, fontWeight: 700, maxWidth: 480, marginBottom: 14 }}>
              Everything you need, delivered simply.
            </h1>
            <p style={{ fontSize: 15, color: '#cddbe6', maxWidth: 440, marginBottom: 22 }}>
              Browse electronics, fashion, home essentials and more — at prices that make sense.
            </p>
            <Link to="/products" className="btn btn-accent">Shop Now</Link>
          </div>
          <img
            src="https://images.unsplash.com/photo-1576072446584-4955dfe17b86?auto=format&fit=crop&w=900&h=600&q=80"
            alt="Featured products collage"
            style={{ flex: '1 1 320px', maxWidth: 480, borderRadius: 8, objectFit: 'cover' }}
          />
        </div>
      </section>

      <div className="container page-wrap">
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 20, marginBottom: 16 }}>Shop by category</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 14 }}>
            {CATEGORY_TILES.map(cat => (
              <Link key={cat.name} to={`/products?category=${encodeURIComponent(cat.name)}`} className="card card-hover" style={{ textAlign: 'center', padding: 14 }}>
                <img src={cat.img} alt={cat.name} style={{ width: 56, height: 56, borderRadius: '50%', margin: '0 auto 10px', objectFit: 'cover' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{cat.name}</span>
              </Link>
            ))}
          </div>
        </section>

        {deals.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
              <h2 style={{ fontSize: 20 }}>Today's Deals</h2>
              <Link to="/products?sort=price_asc" style={{ fontSize: 13, color: 'var(--color-primary)', fontWeight: 600 }}>See all</Link>
            </div>
            {loading ? <GridSkeleton count={6} /> : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                {deals.map(p => <ProductCard key={p._id} product={p} />)}
              </div>
            )}
          </section>
        )}

        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 20, marginBottom: 16 }}>Featured products</h2>
          {loading ? <GridSkeleton /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
              {featured.map(p => <ProductCard key={p._id} product={p} />)}
            </div>
          )}
        </section>

        {recentProducts.length > 0 && (
          <section>
            <h2 style={{ fontSize: 20, marginBottom: 16 }}>Recently viewed</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
              {recentProducts.map(p => <ProductCard key={p._id} product={p} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
