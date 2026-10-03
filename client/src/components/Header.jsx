import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';

const CATEGORIES = ['Electronics', 'Mobiles', 'Laptops', 'Fashion', 'Home & Kitchen', 'Beauty', 'Books', 'Sports', 'Accessories'];

export default function Header() {
  const { user, logout } = useAuth();
  const { cart } = useCart();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);

  function handleSearch(e) {
    e.preventDefault();
    if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ background: 'var(--color-primary)', color: '#fff' }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '12px 20px' }}>
          <Link to="/" style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
            Shop<span style={{ color: 'var(--color-accent)' }}>Nest</span>
          </Link>

          <form onSubmit={handleSearch} style={{ flex: 1, display: 'flex', maxWidth: 560 }} className="header-search">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search for products, brands and categories"
              aria-label="Search products"
              style={{ flex: 1, border: 'none', padding: '9px 12px', borderRadius: '4px 0 0 4px', fontSize: 14, outline: 'none' }}
            />
            <button type="submit" className="btn" style={{ background: 'var(--color-accent)', color: '#24170a', borderRadius: '0 4px 4px 0', padding: '0 16px' }}>
              Search
            </button>
          </form>

          <nav style={{ display: 'flex', alignItems: 'center', gap: 18, marginLeft: 'auto', flexShrink: 0 }} className="header-nav-desktop">
            {user ? (
              <div style={{ position: 'relative' }} className="account-menu">
                <button className="btn-ghost-inline" style={navBtnStyle} onClick={() => setMenuOpen(o => !o)}>
                  Hi, {user.name.split(' ')[0]}
                </button>
                {menuOpen && (
                  <div className="card" style={{ position: 'absolute', right: 0, top: '110%', minWidth: 180, padding: 8, background: '#fff', zIndex: 60, boxShadow: 'var(--shadow-md)' }}>
                    <Link to="/profile" style={dropdownItem} onClick={() => setMenuOpen(false)}>My Profile</Link>
                    <Link to="/orders" style={dropdownItem} onClick={() => setMenuOpen(false)}>My Orders</Link>
                    <Link to="/addresses" style={dropdownItem} onClick={() => setMenuOpen(false)}>Saved Addresses</Link>
                    {user.role === 'admin' && (
                      <Link to="/admin" style={dropdownItem} onClick={() => setMenuOpen(false)}>Admin Dashboard</Link>
                    )}
                    <button style={{ ...dropdownItem, width: '100%', textAlign: 'left', border: 'none', background: 'none' }} onClick={() => { logout(); setMenuOpen(false); navigate('/'); }}>
                      Logout
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link to="/login" style={navBtnStyle}>Login</Link>
            )}
            <Link to="/cart" style={{ ...navBtnStyle, position: 'relative' }}>
              Cart
              {itemCount > 0 && (
                <span style={{
                  position: 'absolute', top: -6, right: -10, background: 'var(--color-accent)', color: '#24170a',
                  fontSize: 11, fontWeight: 700, borderRadius: 10, padding: '1px 6px'
                }}>{itemCount}</span>
              )}
            </Link>
          </nav>

        </div>
      </div>

      <div style={{ background: '#fff', borderBottom: '1px solid var(--color-border)' }} className="category-bar">
        <div className="container" style={{ display: 'flex', gap: 22, padding: '10px 20px', overflowX: 'auto' }}>
          {CATEGORIES.map(cat => (
            <Link key={cat} to={`/products?category=${encodeURIComponent(cat)}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink-soft)', whiteSpace: 'nowrap' }}>
              {cat}
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .header-search { display: none; }
          .header-nav-desktop { gap: 14px; }
          .category-bar { display: none; }
        }
      `}</style>
    </header>
  );
}

const navBtnStyle = { color: '#fff', fontSize: 14, fontWeight: 600, background: 'none', border: 'none', padding: 0 };
const dropdownItem = { display: 'block', padding: '8px 10px', fontSize: 13, color: 'var(--color-ink)', borderRadius: 4 };
