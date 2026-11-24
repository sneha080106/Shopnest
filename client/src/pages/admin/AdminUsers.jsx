import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import Loader from '../../components/Loader';
import Pagination from '../../components/Pagination';

export default function AdminUsers() {
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [role, setRole] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Wait for a short pause in typing before asking the server, so each keystroke is not a request.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (role) params.set('role', role);
    if (search) params.set('search', search);
    api.get(`/admin/users?${params.toString()}`)
      .then(res => { if (!cancelled) setData(res.data); })
      .catch(err => { if (!cancelled) showToast(getErrorMessage(err), 'error'); });
    return () => { cancelled = true; };
  }, [page, role, search]);

  if (!data) return <Loader label="Loading users…" />;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search users"
          maxLength={100}
          style={{ padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13, minWidth: 220 }}
        />
        <select value={role} onChange={e => { setRole(e.target.value); setPage(1); }} aria-label="Filter by role"
          style={{ padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13 }}>
          <option value="">All roles</option>
          <option value="customer">Customers</option>
          <option value="admin">Admins</option>
        </select>
        <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--color-muted)' }}>{data.pagination.total} user{data.pagination.total === 1 ? '' : 's'}</span>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--color-bg)', textAlign: 'left' }}>
              <Th>Name</Th><Th>Email</Th><Th>Phone</Th><Th>Role</Th><Th>Orders</Th><Th>Joined</Th>
            </tr>
          </thead>
          <tbody>
            {data.users.map(u => (
              <tr key={u._id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <Td>{u.name}</Td>
                <Td>{u.email}</Td>
                <Td>{u.phone || '—'}</Td>
                <Td>{u.role}</Td>
                <Td>{u.orderCount}</Td>
                <Td>{new Date(u.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.users.length === 0 && <p style={{ padding: 20, fontSize: 13, color: 'var(--color-muted)' }}>No users found.</p>}
      </div>
      <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
    </div>
  );
}

function Th({ children }) { return <th style={{ padding: '10px 12px', fontWeight: 600 }}>{children}</th>; }
function Td({ children }) { return <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>{children}</td>; }
