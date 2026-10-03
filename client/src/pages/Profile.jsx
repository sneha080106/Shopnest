import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="container page-wrap" style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 20, marginBottom: 20 }}>My Profile</h1>
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <Row label="Name" value={user.name} />
        <Row label="Email" value={user.email} />
        <Row label="Phone" value={user.phone || 'Not added'} />
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
