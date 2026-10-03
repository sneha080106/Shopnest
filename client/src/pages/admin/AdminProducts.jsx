import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { inr } from '../../components/PriceBlock';
import ConfirmDialog from '../../components/ConfirmDialog';
import Loader from '../../components/Loader';
import ProductImage from '../../components/ProductImage';

const emptyForm = { name: '', category: '', brand: '', price: '', mrp: '', stock: '', description: '', images: '' };

export default function AdminProducts() {
  const { showToast } = useToast();
  const [products, setProducts] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteId, setDeleteId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const res = await api.get('/admin/products?limit=100');
    setProducts(res.data.products);
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(p) {
    setEditing(p);
    setForm({
      name: p.name, category: p.category, brand: p.brand, price: p.price, mrp: p.mrp,
      stock: p.stock, description: p.description, images: p.images.join(', ')
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const payload = {
      name: form.name,
      category: form.category,
      brand: form.brand,
      price: Number(form.price),
      mrp: Number(form.mrp),
      stock: Number(form.stock),
      description: form.description,
      shortDescription: form.description.slice(0, 100),
      images: form.images.split(',').map(s => s.trim()).filter(Boolean)
    };
    try {
      if (editing) {
        await api.put(`/admin/products/${editing._id}`, payload);
        showToast('Product updated');
      } else {
        await api.post('/admin/products', payload);
        showToast('Product added');
      }
      setFormOpen(false);
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    try {
      await api.delete(`/admin/products/${deleteId}`);
      showToast('Product removed');
      load();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setDeleteId(null);
    }
  }

  if (!products) return <Loader label="Loading products…" />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--color-muted)' }}>{products.length} products</p>
        {!formOpen && <button className="btn btn-primary btn-sm" onClick={openCreate}>Add product</button>}
      </div>

      {formOpen && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>{editing ? 'Edit product' : 'Add a new product'}</h3>
          {error && <p className="field-error" style={{ marginBottom: 12 }}>{error}</p>}
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Name</label>
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field-row">
              <div className="field">
                <label>Category</label>
                <input required value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
              </div>
              <div className="field">
                <label>Brand</label>
                <input required value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Price (₹)</label>
                <input required type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
              </div>
              <div className="field">
                <label>MRP (₹)</label>
                <input required type="number" value={form.mrp} onChange={e => setForm({ ...form, mrp: e.target.value })} />
              </div>
              <div className="field">
                <label>Stock</label>
                <input required type="number" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>Description</label>
              <textarea required rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="field">
              <label>Image URLs (comma-separated)</label>
              <input value={form.images} onChange={e => setForm({ ...form, images: e.target.value })} placeholder="https://…, https://…" />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving…' : 'Save product'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--color-bg)', textAlign: 'left' }}>
              <Th>Product</Th><Th>Category</Th><Th>Price</Th><Th>Stock</Th><Th>Status</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <tr key={p._id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <Td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ProductImage src={p.images[0]} alt="" style={{ width: 34, height: 34, borderRadius: 4, objectFit: 'cover' }} />
                    <span style={{ maxWidth: 220 }}>{p.name}</span>
                  </div>
                </Td>
                <Td>{p.category}</Td>
                <Td>{inr(p.price)}</Td>
                <Td>{p.stock}</Td>
                <Td>{p.isActive ? 'Active' : 'Removed'}</Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>Edit</button>
                    {p.isActive && <button className="btn btn-ghost btn-sm" onClick={() => setDeleteId(p._id)}>Delete</button>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        title="Remove product?"
        description="The product will be hidden from the store."
        confirmLabel="Remove"
        onCancel={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function Th({ children }) { return <th style={{ padding: '10px 12px', fontWeight: 600 }}>{children}</th>; }
function Td({ children }) { return <td style={{ padding: '10px 12px' }}>{children}</td>; }
