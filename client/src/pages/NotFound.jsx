import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="container page-wrap" style={{ textAlign: 'center', padding: '80px 20px' }}>
      <h1 style={{ fontSize: 48, color: 'var(--color-primary)', marginBottom: 10 }}>404</h1>
      <p style={{ fontSize: 15, color: 'var(--color-ink-soft)', marginBottom: 22 }}>
        We couldn't find the page you're looking for.
      </p>
      <Link to="/" className="btn btn-primary">Back to home</Link>
    </div>
  );
}
