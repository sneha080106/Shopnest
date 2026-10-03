import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    const res = await api.post('/auth/forgot-password', { email });
    setMessage(res.data.message);
    setSubmitting(false);
  }

  return (
    <div className="container page-wrap" style={{ maxWidth: 420 }}>
      <div className="card" style={{ padding: 28 }}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Reset your password</h1>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 22 }}>
          Enter the email associated with your account.
        </p>
        {message ? (
          <p style={{ fontSize: 14, color: 'var(--color-success)' }}>{message}</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block" disabled={submitting}>{submitting ? 'Sending…' : 'Send reset link'}</button>
          </form>
        )}
        <p style={{ fontSize: 13, marginTop: 18, textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Back to login</Link>
        </p>
      </div>
    </div>
  );
}
