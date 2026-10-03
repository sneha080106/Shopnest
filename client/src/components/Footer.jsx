import React from 'react';

const columns = [
  { title: 'ShopNest', links: ['About', 'Careers', 'Contact us'] },
  { title: 'Help', links: ['Help center', 'Shipping', 'Returns & refunds'] },
  { title: 'Policy', links: ['Privacy policy', 'Terms of use'] }
];

export default function Footer() {
  return (
    <footer style={{ background: 'var(--color-primary-dark)', color: '#c7d3dc', marginTop: 40 }}>
      <div className="container" style={{ padding: '36px 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 24 }}>
        {columns.map(col => (
          <div key={col.title}>
            <h4 style={{ color: '#fff', fontSize: 14, marginBottom: 12 }}>{col.title}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {col.links.map(link => (
                <a key={link} href="#" style={{ fontSize: 13, color: '#c7d3dc' }}>{link}</a>
              ))}
            </div>
          </div>
        ))}
        <div>
          <h4 style={{ color: '#fff', fontSize: 14, marginBottom: 12 }}>Follow us</h4>
          <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
            <a href="#" style={{ color: '#c7d3dc' }}>Instagram</a>
            <a href="#" style={{ color: '#c7d3dc' }}>X</a>
          </div>
        </div>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', padding: '14px 20px', textAlign: 'center', fontSize: 12 }}>
        © {new Date().getFullYear()} ShopNest. All rights reserved. This is a demo project — no real payments are processed.
      </div>
    </footer>
  );
}
