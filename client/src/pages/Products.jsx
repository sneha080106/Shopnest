import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import ProductCard from '../components/ProductCard';
import { GridSkeleton } from '../components/Loader';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';

export default function Products() {
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [filterMeta, setFilterMeta] = useState({ categories: [], brands: [], priceRange: { min: 0, max: 0 } });
  const [loading, setLoading] = useState(true);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const search = params.get('q') || '';
  const category = params.get('category') || '';
  const brand = params.get('brand') || '';
  const minPrice = params.get('minPrice') || '';
  const maxPrice = params.get('maxPrice') || '';
  const minRating = params.get('minRating') || '';
  const sort = params.get('sort') || (search ? 'relevance' : 'newest');
  const page = Number(params.get('page') || 1);

  useEffect(() => {
    api.get('/products/filters').then(res => setFilterMeta(res.data));
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const query = new URLSearchParams();
      if (search) query.set('search', search);
      if (category) query.set('category', category);
      if (brand) query.set('brand', brand);
      if (minPrice) query.set('minPrice', minPrice);
      if (maxPrice) query.set('maxPrice', maxPrice);
      if (minRating) query.set('minRating', minRating);
      query.set('sort', sort);
      query.set('page', page);
      query.set('limit', 12);
      const res = await api.get(`/products?${query.toString()}`);
      setProducts(res.data.products);
      setPagination(res.data.pagination);
      setLoading(false);
    }
    load();
  }, [search, category, brand, minPrice, maxPrice, minRating, sort, page]);

  function updateParam(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    next.delete('page');
    setParams(next);
  }

  function toggleBrand(b) {
    const current = brand ? brand.split(',') : [];
    const next = current.includes(b) ? current.filter(x => x !== b) : [...current, b];
    updateParam('brand', next.join(','));
  }

  const selectedBrands = useMemo(() => (brand ? brand.split(',') : []), [brand]);

  return (
    <div className="container page-wrap">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 20 }}>
          {search ? `Results for "${search}"` : category || 'All products'}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost btn-sm filters-toggle" onClick={() => setMobileFiltersOpen(o => !o)}>Filters</button>
          <select value={sort} onChange={e => updateParam('sort', e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13 }}>
            {search && <option value="relevance">Relevance</option>}
            <option value="newest">Newest</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="rating">Rating</option>
          </select>
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 20 }}>{pagination.total} products</p>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <aside className="card filters-panel" style={{ width: 220, flexShrink: 0, padding: 16, display: mobileFiltersOpen ? 'block' : undefined }}>
          <div className="filters-panel-header" style={{ display: 'none', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--color-border)' }}>
            <h3 style={{ fontSize: 15 }}>Filters</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setMobileFiltersOpen(false)}>Done</button>
          </div>
          <div style={{ marginBottom: 20 }}>
            <h4 style={{ fontSize: 13, marginBottom: 10 }}>Category</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filterMeta.categories.map(cat => (
                <label key={cat} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="radio" name="category" checked={category === cat} onChange={() => updateParam('category', cat)} />
                  {cat}
                </label>
              ))}
              {category && (
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => updateParam('category', '')}>Clear</button>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <h4 style={{ fontSize: 13, marginBottom: 10 }}>Price range</h4>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" placeholder="Min" defaultValue={minPrice} onBlur={e => updateParam('minPrice', e.target.value)}
                style={{ width: '50%', padding: 6, border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13 }} />
              <input type="number" placeholder="Max" defaultValue={maxPrice} onBlur={e => updateParam('maxPrice', e.target.value)}
                style={{ width: '50%', padding: 6, border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13 }} />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <h4 style={{ fontSize: 13, marginBottom: 10 }}>Minimum rating</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[4, 3, 2].map(r => (
                <label key={r} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="radio" name="rating" checked={minRating === String(r)} onChange={() => updateParam('minRating', String(r))} />
                  {r}★ & above
                </label>
              ))}
              {minRating && <button className="btn btn-ghost btn-sm" onClick={() => updateParam('minRating', '')}>Clear</button>}
            </div>
          </div>

          <div>
            <h4 style={{ fontSize: 13, marginBottom: 10 }}>Brand</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
              {filterMeta.brands.map(b => (
                <label key={b} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={selectedBrands.includes(b)} onChange={() => toggleBrand(b)} />
                  {b}
                </label>
              ))}
            </div>
          </div>
        </aside>

        <div style={{ flex: 1 }}>
          {loading ? (
            <GridSkeleton count={9} />
          ) : products.length === 0 ? (
            <EmptyState title="No products found" description="Try adjusting your filters or search terms." />
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                {products.map(p => <ProductCard key={p._id} product={p} />)}
              </div>
              <Pagination page={pagination.page} totalPages={pagination.totalPages} onChange={p => updateParam('page', String(p))} />
            </>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .filters-panel { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 100; width: auto; overflow-y: auto; border-radius: 0; padding: 20px !important; }
          .filters-panel-header { display: flex !important; }
          .filters-toggle { display: inline-flex; }
        }
        @media (min-width: 861px) {
          .filters-toggle { display: none; }
        }
      `}</style>
    </div>
  );
}
