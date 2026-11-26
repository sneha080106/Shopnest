import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import Loader from '../../components/Loader';

export default function AdminCategories() {
  const { showToast } = useToast();
  const [categories, setCategories] = useState(null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await api.get('/admin/categories');
      setCategories(res.data.categories);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  }

  useEffect(() => { load(); }, []);

  async function run(action, successMessage) {
    setBusy(true);
    try {
      await action();
      showToast(successMessage, 'success');
      await load();
      return true;
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    const name = newName.trim();
    if (name.length < 2 || name.length > 40) { showToast('Category name must be between 2 and 40 characters', 'error'); return; }
    if (await run(() => api.post('/admin/categories', { name }), 'Category added')) setNewName('');
  }

  async function handleRename(id) {
    const name = editName.trim();
    if (name.length < 2 || name.length > 40) { showToast('Category name must be between 2 and 40 characters', 'error'); return; }
    if (await run(() => api.put(`/admin/categories/${id}`, { name }), 'Category renamed')) setEditingId(null);
  }

  async function handleDelete() {
    const id = deleting._id;
    setDeleting(null);
    await run(() => api.delete(`/admin/categories/${id}`), 'Category deleted');
  }

  if (!categories) return <Loader label="Loading categories…" />;

  return (
    <div>
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="New category name"
          aria-label="New category name"
          maxLength={40}
          style={{ padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13, minWidth: 240 }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>Add category</button>
      </form>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--color-bg)', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px' }}>Category</th>
              <th style={{ padding: '10px 12px' }}>Products</th>
              <th style={{ padding: '10px 12px' }}></th>
            </tr>
          </thead>
          <tbody>
            {categories.map(c => (
              <tr key={c._id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: '10px 12px' }}>
                  {editingId === c._id ? (
                    <input
                      autoFocus
                      value={editName}
                      maxLength={40}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRename(c._id); if (e.key === 'Escape') setEditingId(null); }}
                      aria-label={`Rename ${c.name}`}
                      style={{ padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13 }}
                    />
                  ) : c.name}
                </td>
                <td style={{ padding: '10px 12px' }}>{c.productCount}</td>
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {editingId === c._id ? (
                    <>
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => handleRename(c._id)}>Save</button>{' '}
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditingId(c._id); setEditName(c.name); }}>Rename</button>{' '}
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={c.productCount > 0}
                        title={c.productCount > 0 ? 'Move or remove its products first' : 'Delete category'}
                        onClick={() => setDeleting(c)}
                      >Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {categories.length === 0 && <p style={{ padding: 20, fontSize: 13, color: 'var(--color-muted)' }}>No categories yet. Add the first one above.</p>}
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 10 }}>Renaming a category also renames it on all of its products. A category with products cannot be deleted.</p>

      <ConfirmDialog
        open={!!deleting}
        title="Delete category?"
        description={deleting ? `"${deleting.name}" will be removed from the list.` : ''}
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
