import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, { getErrorMessage } from '../services/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const CartContext = createContext(null);
const GUEST_CART_KEY = 'shopnest_guest_cart';

function readGuestCart() {
  try {
    return JSON.parse(localStorage.getItem(GUEST_CART_KEY)) || [];
  } catch {
    return [];
  }
}
function writeGuestCart(items) {
  localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
}

export function CartProvider({ children }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [cart, setCart] = useState({ items: [], subtotal: 0, discount: 0, deliveryFee: 0, total: 0 });
  const [loading, setLoading] = useState(false);

  const computeGuestTotals = useCallback(async (guestItems) => {
    if (guestItems.length === 0) {
      return { items: [], subtotal: 0, discount: 0, deliveryFee: 0, total: 0 };
    }
    const results = await Promise.all(
      guestItems.map(async gi => {
        try {
          const res = await api.get(`/products/${gi.slug}`);
          return { ...gi, product: res.data.product };
        } catch {
          return null;
        }
      })
    );
    const items = results.filter(Boolean).map((gi, idx) => ({
      _id: `guest-${idx}`,
      quantity: gi.quantity,
      variant: gi.variant,
      product: gi.product
    }));
    const subtotal = items.reduce((s, i) => s + i.product.price * i.quantity, 0);
    const mrpTotal = items.reduce((s, i) => s + i.product.mrp * i.quantity, 0);
    const discount = Math.max(0, mrpTotal - subtotal);
    const deliveryFee = subtotal > 0 && subtotal < 499 ? 49 : 0;
    return { items, subtotal, discount, deliveryFee, total: subtotal + deliveryFee };
  }, []);

  const refreshCart = useCallback(async () => {
    setLoading(true);
    try {
      if (user) {
        const res = await api.get('/cart');
        setCart(res.data.cart);
      } else {
        const totals = await computeGuestTotals(readGuestCart());
        setCart(totals);
      }
    } finally {
      setLoading(false);
    }
  }, [user, computeGuestTotals]);

  useEffect(() => { refreshCart(); }, [refreshCart]);

  async function addToCart(product, quantity = 1, variant = null) {
    if (user) {
      try {
        const res = await api.post('/cart', { productId: product._id, quantity, variant });
        setCart(res.data.cart);
        showToast('Added to cart');
      } catch (err) {
        showToast(getErrorMessage(err), 'error');
      }
    } else {
      const items = readGuestCart();
      const existing = items.find(i => i.slug === product.slug && i.variant === variant);
      if (existing) existing.quantity += quantity;
      else items.push({ slug: product.slug, quantity, variant });
      writeGuestCart(items);
      const totals = await computeGuestTotals(items);
      setCart(totals);
      showToast('Added to cart');
    }
  }

  async function updateQuantity(itemId, quantity) {
    if (user) {
      try {
        const res = await api.put(`/cart/${itemId}`, { quantity });
        setCart(res.data.cart);
      } catch (err) {
        showToast(getErrorMessage(err), 'error');
      }
    } else {
      const idx = Number(itemId.replace('guest-', ''));
      const items = readGuestCart();
      if (items[idx]) items[idx].quantity = quantity;
      writeGuestCart(items);
      setCart(await computeGuestTotals(items));
    }
  }

  async function removeItem(itemId) {
    if (user) {
      try {
        const res = await api.delete(`/cart/${itemId}`);
        setCart(res.data.cart);
        showToast('Removed from cart');
      } catch (err) {
        showToast(getErrorMessage(err), 'error');
      }
    } else {
      const idx = Number(itemId.replace('guest-', ''));
      const items = readGuestCart();
      items.splice(idx, 1);
      writeGuestCart(items);
      setCart(await computeGuestTotals(items));
      showToast('Removed from cart');
    }
  }

  async function clearGuestCartOnly() {
    writeGuestCart([]);
  }

  return (
    <CartContext.Provider value={{ cart, loading, addToCart, updateQuantity, removeItem, refreshCart, clearGuestCartOnly }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
