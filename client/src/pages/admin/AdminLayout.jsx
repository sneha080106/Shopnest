import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';

export default function AdminLayout() {
  return (
    <div className="container page-wrap">
      <h1 style={{ fontSize: 20, marginBottom: 6 }}>Admin Dashboard</h1>
      <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 20 }}>Manage products, categories, orders and users.</p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, borderBottom: '1px solid var(--color-border)' }}>
        <AdminTab to="/admin/products" label="Products" />
        <AdminTab to="/admin/categories" label="Categories" />
        <AdminTab to="/admin/orders" label="Orders" />
        <AdminTab to="/admin/users" label="Users" />
      </div>
      <Outlet />
    </div>
  );
}

function AdminTab({ to, label }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        padding: '10px 4px',
        fontSize: 14,
        fontWeight: 600,
        color: isActive ? 'var(--color-primary)' : 'var(--color-muted)',
        borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent'
      })}
    >
      {label}
    </NavLink>
  );
}
