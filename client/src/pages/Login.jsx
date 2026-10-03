import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Login() {
  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const res = await login(form.email, form.password);
    setSubmitting(false);
    if (res.success) {
      showToast('Logged in successfully');
      const redirectTo = location.state?.from?.pathname || '/';
      navigate(redirectTo, { replace: true });
    } else {
      setError(res.message);
    }
  }

  return (
    <div className="container page-wrap" style={{ maxWidth: 420 }}>
      <div className="card" style={{ padding: 28 }}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Log in to ShopNest</h1>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 22 }}>Welcome back. Enter your details to continue.</p>
        {error && <p className="field-error" style={{ marginBottom: 14 }}>{error}</p>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          </div>
          <div style={{ textAlign: 'right', marginBottom: 16 }}>
            <Link to="/forgot-password" style={{ fontSize: 12, color: 'var(--color-primary)' }}>Forgot password?</Link>
          </div>
          <button className="btn btn-primary btn-block" disabled={submitting}>{submitting ? 'Logging in…' : 'Log In'}</button>
        </form>
        <p style={{ fontSize: 13, marginTop: 18, textAlign: 'center', color: 'var(--color-muted)' }}>
          New to ShopNest? <Link to="/register" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Create an account</Link>
        </p>
      </div>
    </div>
  );
}
