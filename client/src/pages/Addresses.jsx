import React, { useState } from 'react';
import api, { getErrorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AddressForm from '../components/AddressForm';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';

export default function Addresses() {
  const { user, updateUserAddresses } = useAuth();
  const { showToast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd(data) {
    setSubmitting(true);
    try {
      const res = await api.post('/addresses', data);
      updateUserAddresses(res.data.addresses);
      showToast('Address saved');
      setFormOpen(false);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(data) {
    setSubmitting(true);
    try {
      const res = await api.put(`/addresses/${editing._id}`, data);
      updateUserAddresses(res.data.addresses);
      showToast('Address updated');
      setEditing(null);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    try {
      const res = await api.delete(`/addresses/${deleteId}`);
      updateUserAddresses(res.data.addresses);
      showToast('Address removed');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setDeleteId(null);
    }
  }

  const addresses = user?.addresses || [];

  return (
    <div className="container page-wrap" style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20 }}>Saved addresses</h1>
        {!formOpen && <button className="btn btn-primary btn-sm" onClick={() => setFormOpen(true)}>Add address</button>}
      </div>

      {formOpen && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>Add a new address</h3>
          <AddressForm onSubmit={handleAdd} onCancel={() => setFormOpen(false)} submitting={submitting} />
        </div>
      )}

      {addresses.length === 0 && !formOpen ? (
        <EmptyState title="No addresses saved yet" description="Add a delivery address to speed up checkout." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {addresses.map(addr => (
            <div key={addr._id} className="card" style={{ padding: 16 }}>
              {editing?._id === addr._id ? (
                <AddressForm initial={editing} onSubmit={handleUpdate} onCancel={() => setEditing(null)} submitting={submitting} />
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary)', background: 'var(--color-primary-tint)', padding: '2px 8px', borderRadius: 4 }}>
                        {addr.type}{addr.isDefault ? ' · Default' : ''}
                      </span>
                      <p style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>{addr.fullName} · {addr.phone}</p>
                      <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginTop: 4 }}>
                        {addr.houseNumber}, {addr.street}, {addr.city}, {addr.state} - {addr.pincode}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(addr)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDeleteId(addr._id)}>Delete</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Delete address?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        onCancel={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
