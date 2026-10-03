import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Register() {
  const { register } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', phone: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setSubmitting(true);
    const res = await register(form);
    setSubmitting(false);
    if (res.success) {
      showToast('Account created');
      navigate('/');
    } else {
      setError(res.message);
    }
  }

  return (
    <div className="container page-wrap" style={{ maxWidth: 440 }}>
      <div className="card" style={{ padding: 28 }}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Create your account</h1>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 22 }}>It only takes a minute.</p>
        {error && <p className="field-error" style={{ marginBottom: 14 }}>{error}</p>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone (optional)</label>
            <input id="phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="confirmPassword">Confirm password</label>
              <input id="confirmPassword" type="password" required value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary btn-block" disabled={submitting} style={{ marginTop: 6 }}>
            {submitting ? 'Creating account…' : 'Create Account'}
          </button>
        </form>
        <p style={{ fontSize: 13, marginTop: 18, textAlign: 'center', color: 'var(--color-muted)' }}>
          Already have an account? <Link to="/login" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Log in</Link>
        </p>
      </div>
    </div>
  );
}
