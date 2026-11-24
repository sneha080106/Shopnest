import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const { user, logout, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setForm({ name: user.name || '', phone: user.phone || '' });
    setError('');
    setMessage('');
    setEditing(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    const name = form.name.trim();
    if (name.length < 2 || name.length > 60) { setError('Name must be between 2 and 60 characters'); return; }
    if (form.phone && !/^\d{10}$/.test(form.phone)) { setError('Phone number must be 10 digits'); return; }
    setSaving(true);
    const result = await updateProfile({ name, phone: form.phone });
    setSaving(false);
    if (!result.success) { setError(result.message); return; }
    setEditing(false);
    setMessage('Profile updated');
  }

  return (
    <div className="container page-wrap" style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 20, marginBottom: 20 }}>My Profile</h1>
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        {editing ? (
          <form onSubmit={handleSave}>
            {error && <p className="field-error" style={{ marginBottom: 12 }}>{error}</p>}
            <div className="field">
              <label>Name</label>
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Phone number</label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="10-digit mobile number (optional)" />
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12 }}>Email: {user.email} (cannot be changed here)</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            {message && <p style={{ color: 'var(--color-success, #1a7f37)', fontSize: 13, marginBottom: 8 }}>{message}</p>}
            <Row label="Name" value={user.name} />
            <Row label="Email" value={user.email} />
            <Row label="Phone" value={user.phone || 'Not added'} />
            <button type="button" className="btn btn-ghost" style={{ marginTop: 14 }} onClick={startEdit}>Edit profile</button>
          </>
        )}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <MenuLink to="/orders" label="My Orders" />
        <MenuLink to="/addresses" label="Saved Addresses" />
        {user.role === 'admin' && <MenuLink to="/admin" label="Admin Dashboard" />}
        <button
          onClick={() => { logout(); navigate('/'); }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '14px 18px', fontSize: 14, background: 'none', border: 'none', color: 'var(--color-danger)' }}
        >
          Logout
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--color-border)', fontSize: 14 }}>
      <span style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function MenuLink({ to, label }) {
  return (
    <Link to={to} style={{ display: 'block', padding: '14px 18px', fontSize: 14, borderBottom: '1px solid var(--color-border)' }}>
      {label}
    </Link>
  );
}
