// A small stateful in-memory stand-in for the Mongoose models the order/payment controllers use.
// It exists so the controllers' real logic (verification, atomic claim, stock reservation,
// rollback, idempotency) can be exercised without a MongoDB server.
//
// What it is NOT: a MongoDB emulator. It implements only the query/update operators the controllers
// use, and throws on anything else so a test can't silently pass on an unsupported operator.
// Like MongoDB's single-document operations, each findOneAndUpdate/updateOne runs atomically
// (no await between the match and the write), while awaits between calls let concurrent requests
// interleave - which is what the double-spend tests rely on.

const { calculateOrderTotals } = require('../../../utils/pricing');

let seq = 0;
const newId = () => `id${++seq}`;

const store = { products: [], orders: [], payments: [], users: [], carts: [] };
const hooks = { failOrderCreate: null };

function reset() {
  seq = 0;
  Object.keys(store).forEach(k => { store[k].length = 0; });
  hooks.failOrderCreate = null;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const ops = Object.keys(cond);
      if (!ops.every(op => op.startsWith('$'))) {
        throw new Error(`fakeModels: object used as a plain value for "${key}" (would be an operator injection in Mongo)`);
      }
      return ops.every(op => {
        const operand = cond[op];
        const num = x => (x instanceof Date ? x.getTime() : x);
        if (op === '$gte') return num(value) >= num(operand);
        if (op === '$gt') return value != null && num(value) > num(operand);
        if (op === '$in') return operand.some(x => String(x) === String(value));
        if (op === '$ne') return operand === null ? value != null : String(value) !== String(operand);
        throw new Error(`fakeModels: unsupported operator ${op}`);
      });
    }
    if (cond === null) return value == null;
    return String(value) === String(cond);
  });
}

function applyUpdate(doc, update) {
  Object.entries(update.$inc || {}).forEach(([k, v]) => { doc[k] = (doc[k] || 0) + v; });
  Object.entries(update.$set || {}).forEach(([k, v]) => { doc[k] = v; });
  Object.keys(update.$unset || {}).forEach(k => { delete doc[k]; });
  const known = new Set(['$inc', '$set', '$unset']);
  Object.keys(update).forEach(op => { if (!known.has(op)) throw new Error(`fakeModels: unsupported update operator ${op}`); });
}

const copy = doc => (doc ? { ...doc } : null);

const Product = {
  findOneAndUpdate: async (filter, update) => {
    const doc = store.products.find(d => matches(d, filter));
    if (!doc) return null;
    applyUpdate(doc, update);
    return copy(doc);
  },
  findById: async id => copy(store.products.find(d => d._id === String(id))),
  updateOne: async (filter, update) => {
    const doc = store.products.find(d => matches(d, filter));
    if (doc) applyUpdate(doc, update);
    return { matchedCount: doc ? 1 : 0 };
  }
};

function dupError(keyPattern) {
  const err = new Error('E11000 duplicate key error');
  err.code = 11000;
  err.keyPattern = keyPattern;
  err.keyValue = { ...keyPattern };
  return err;
}

const Order = {
  findOne: async filter => store.orders.find(d => matches(d, filter)) || null,
  findById: async id => store.orders.find(d => d._id === String(id)) || null,
  // Atomic like MongoDB's single-document operations (no await between the match and the write).
  findOneAndUpdate: async (filter, update) => {
    const doc = store.orders.find(d => matches(d, filter));
    if (!doc) return null;
    applyUpdate(doc, update);
    return doc;
  },
  updateOne: async (filter, update) => {
    const doc = store.orders.find(d => matches(d, filter));
    if (doc) applyUpdate(doc, update);
    return { matchedCount: doc ? 1 : 0 };
  },
  create: async doc => {
    if (hooks.failOrderCreate) throw hooks.failOrderCreate;
    if (doc.clientRequestId && store.orders.some(o => o.clientRequestId === doc.clientRequestId)) {
      throw dupError({ clientRequestId: 1 });
    }
    if (doc.payment && store.orders.some(o => String(o.payment) === String(doc.payment))) {
      throw dupError({ payment: 1 });
    }
    const order = {
      _id: newId(), emailSent: false, stockReleased: false, ...doc,
      async save() { return this; },
      toObject() { const { save, toObject, ...rest } = this; return { ...rest }; }
    };
    store.orders.push(order);
    return order;
  }
};

const Payment = {
  create: async doc => {
    if (store.payments.some(p => p.reference === doc.reference)) throw dupError({ reference: 1 });
    const payment = {
      _id: newId(), order: null, currency: 'INR', provider: 'demo', simulated: true,
      createdAt: new Date(), ...doc
    };
    store.payments.push(payment);
    return copy(payment);
  },
  findOne: async filter => copy(store.payments.find(d => matches(d, filter))),
  findOneAndUpdate: async (filter, update) => {
    const doc = store.payments.find(d => matches(d, filter));
    if (!doc) return null;
    applyUpdate(doc, update);
    return copy(doc);
  },
  updateOne: async (filter, update) => {
    const doc = store.payments.find(d => matches(d, filter));
    if (doc) applyUpdate(doc, update);
    return { matchedCount: doc ? 1 : 0 };
  }
};

const User = {
  findById: async id => store.users.find(u => u._id === String(id)) || null
};

// Stand-in for controllers/cartController (same two functions, same return shape).
const cartController = {
  getOrCreateCart: async userId => {
    let cart = store.carts.find(c => c.user === String(userId));
    if (!cart) {
      cart = { user: String(userId), items: [], async save() { return this; } };
      store.carts.push(cart);
    }
    return cart;
  },
  populateCart: async cart => {
    const items = cart.items
      .map(i => ({ _id: i._id, quantity: i.quantity, variant: i.variant ?? null, product: store.products.find(p => p._id === i.product) }))
      .filter(i => i.product);
    const totals = calculateOrderTotals(items.map(i => ({ price: i.product.price, mrp: i.product.mrp, quantity: i.quantity })));
    return { items, ...totals };
  }
};

// A Cart model that behaves enough like Mongoose's for the REAL controllers/cartController to run
// against it (subdocument .id(), .deleteOne(), .populate(), push() casting quantity to a Number).
// Backed by the same store.carts that setCart() seeds, so both styles of test can share it.
function shapeCart(cart) {
  const items = cart.items;
  const defineHidden = (obj, key, value) =>
    Object.defineProperty(obj, key, { value, enumerable: false, configurable: true, writable: true });

  const attachItem = item => {
    if (!item.deleteOne) {
      defineHidden(item, 'deleteOne', () => { const i = items.indexOf(item); if (i >= 0) items.splice(i, 1); });
    }
    return item;
  };
  if (!items.id) {
    defineHidden(items, 'id', id => items.find(i => String(i._id) === String(id)) || null);
    const nativePush = Array.prototype.push.bind(items);
    defineHidden(items, 'push', (...docs) => nativePush(...docs.map(d =>
      attachItem({ _id: newId(), ...d, quantity: Number(d.quantity), variant: d.variant ?? null }))));
  }
  items.forEach(attachItem);
  if (!cart.populate) {
    defineHidden(cart, 'populate', async () => ({
      items: cart.items.map(i => ({
        _id: i._id, quantity: i.quantity, variant: i.variant ?? null,
        product: store.products.find(p => p._id === String(i.product)) || null
      }))
    }));
  }
  return cart;
}

const Cart = {
  findOne: async filter => {
    const cart = store.carts.find(c => matches(c, filter));
    return cart ? shapeCart(cart) : null;
  },
  create: async doc => {
    const cart = { user: String(doc.user), items: [...(doc.items || [])], async save() { return this; } };
    store.carts.push(cart);
    return shapeCart(cart);
  }
};

// ---- seeding helpers ----
function seedProduct(overrides = {}) {
  const product = {
    _id: newId(), name: 'Test product', price: 500, mrp: 500, stock: 5, isActive: true, images: ['x.jpg'],
    ...overrides
  };
  store.products.push(product);
  return product;
}

function seedUser(overrides = {}) {
  const id = overrides._id || newId();
  const addr = { _id: `addr-${id}`, fullName: 'Test User', phone: '9999999999', houseNumber: '1', street: 'Main', city: 'Pune', state: 'MH', pincode: '411001', type: 'Home' };
  const addresses = Object.assign([addr], { id: addrId => (String(addrId) === addr._id ? addr : null) });
  const user = { _id: id, email: `${id}@example.com`, addresses, ...overrides };
  store.users.push(user);
  return { user, addressId: addr._id };
}

function setCart(userId, lines) {
  const cart = store.carts.find(c => c.user === String(userId)) || (store.carts.push({ user: String(userId), items: [], async save() { return this; } }), store.carts[store.carts.length - 1]);
  cart.items = lines.map(l => ({ _id: newId(), product: l.product._id || l.product, quantity: l.quantity, variant: l.variant ?? null }));
  return cart;
}

module.exports = { store, hooks, reset, Product, Order, Payment, User, Cart, cartController, seedProduct, seedUser, setCart };
