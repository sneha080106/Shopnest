import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { getErrorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const { showToast } = useToast();
  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post(`/auth/reset-password/${token}`, form);
      setSession(res.data.token, res.data.user);
      showToast('Password updated');
      navigate('/');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container page-wrap" style={{ maxWidth: 420 }}>
      <div className="card" style={{ padding: 28 }}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Choose a new password</h1>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 22 }}>
          This link expires 30 minutes after it was requested.
        </p>
        {error && <p className="field-error" style={{ marginBottom: 14 }}>{error}</p>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="password">New password</label>
            <input id="password" type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Confirm new password</label>
            <input id="confirmPassword" type="password" required value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })} />
          </div>
          <button className="btn btn-primary btn-block" disabled={submitting}>{submitting ? 'Updating…' : 'Update password'}</button>
        </form>
        <p style={{ fontSize: 13, marginTop: 18, textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Back to login</Link>
        </p>
      </div>
    </div>
  );
}
