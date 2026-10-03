import React, { useState } from 'react';

const empty = { fullName: '', phone: '', houseNumber: '', street: '', city: '', state: '', pincode: '', type: 'Home' };

export default function AddressForm({ initial, onSubmit, onCancel, submitting }) {
  const [form, setForm] = useState(initial || empty);
  const [error, setError] = useState('');

  function set(key, value) { setForm(prev => ({ ...prev, [key]: value })); }

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!/^\d{10}$/.test(form.phone)) { setError('Phone number must be 10 digits'); return; }
    if (!/^\d{6}$/.test(form.pincode)) { setError('Pincode must be 6 digits'); return; }
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="field-error" style={{ marginBottom: 12 }}>{error}</p>}
      <div className="field-row">
        <div className="field">
          <label>Full name</label>
          <input required value={form.fullName} onChange={e => set('fullName', e.target.value)} />
        </div>
        <div className="field">
          <label>Phone number</label>
          <input required value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="10-digit mobile number" />
        </div>
      </div>
      <div className="field">
        <label>House / Flat number</label>
        <input required value={form.houseNumber} onChange={e => set('houseNumber', e.target.value)} />
      </div>
      <div className="field">
        <label>Street / Area</label>
        <input required value={form.street} onChange={e => set('street', e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>City</label>
          <input required value={form.city} onChange={e => set('city', e.target.value)} />
        </div>
        <div className="field">
          <label>State</label>
          <input required value={form.state} onChange={e => set('state', e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Pincode</label>
          <input required value={form.pincode} onChange={e => set('pincode', e.target.value)} />
        </div>
        <div className="field">
          <label>Address type</label>
          <select value={form.type} onChange={e => set('type', e.target.value)}>
            <option value="Home">Home</option>
            <option value="Work">Work</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving…' : 'Save address'}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
