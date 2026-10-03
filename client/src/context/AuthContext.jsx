import React, { createContext, useContext, useEffect, useState } from 'react';
import api, { getErrorMessage } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('shopnest_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api.get('/auth/me')
      .then(res => setUser(res.data.user))
      .catch(() => localStorage.removeItem('shopnest_token'))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    try {
      const res = await api.post('/auth/login', { email, password });
      localStorage.setItem('shopnest_token', res.data.token);
      setUser(res.data.user);
      return { success: true };
    } catch (err) {
      return { success: false, message: getErrorMessage(err) };
    }
  }

  async function register(payload) {
    try {
      const res = await api.post('/auth/register', payload);
      localStorage.setItem('shopnest_token', res.data.token);
      setUser(res.data.user);
      return { success: true };
    } catch (err) {
      return { success: false, message: getErrorMessage(err) };
    }
  }

  function logout() {
    localStorage.removeItem('shopnest_token');
    setUser(null);
  }

  // Used after a successful password reset, which returns a fresh token + user the same way
  // login/register do — reuses that response instead of making the user log in a second time.
  function setSession(token, nextUser) {
    localStorage.setItem('shopnest_token', token);
    setUser(nextUser);
  }

  function updateUserAddresses(addresses) {
    setUser(prev => (prev ? { ...prev, addresses } : prev));
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, setSession, updateUserAddresses }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
