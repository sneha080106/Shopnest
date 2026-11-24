// PUT /api/auth/me: a customer may change only their name and phone. Real controller, fake user document.

jest.mock('../../models/User', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('../../utils/sendEmail', () => jest.fn(async () => ({ sent: false, error: 'off' })));

const { updateMe, PROFILE_WRITABLE_FIELDS } = require('../../controllers/authController');

function makeUser() {
  const user = {
    name: 'Sneha', email: 'sneha@example.com', phone: '9876543210', role: 'customer',
    save: jest.fn(async () => user),
    toSafeObject() { return { name: this.name, email: this.email, phone: this.phone, role: this.role }; }
  };
  return user;
}
async function call(body, user = makeUser()) {
  const res = { json: jest.fn() };
  const next = jest.fn();
  await updateMe({ body, user }, res, next);
  return { user, res, error: next.mock.calls[0]?.[0] };
}

describe('allowed changes', () => {
  test('updates name and phone, trims the name, saves once, returns the safe user', async () => {
    const r = await call({ name: '  Sneha K  ', phone: '9123456780' });
    expect(r.error).toBeUndefined();
    expect(r.user.name).toBe('Sneha K');
    expect(r.user.phone).toBe('9123456780');
    expect(r.user.save).toHaveBeenCalledTimes(1);
    expect(r.res.json).toHaveBeenCalledWith({ success: true, user: { name: 'Sneha K', email: 'sneha@example.com', phone: '9123456780', role: 'customer' } });
  });

  test('a request with only the name leaves the phone alone (and vice versa)', async () => {
    expect((await call({ name: 'New Name' })).user.phone).toBe('9876543210');
    expect((await call({ phone: '9000000000' })).user.name).toBe('Sneha');
  });

  test('an empty phone removes the saved number', async () => {
    const r = await call({ phone: '' });
    expect(r.error).toBeUndefined();
    expect(r.user.phone).toBeUndefined();
    expect(r.user.save).toHaveBeenCalled();
  });
});

describe('fields that must never be changeable here', () => {
  test('the allowlist is exactly name and phone', () => {
    expect(PROFILE_WRITABLE_FIELDS).toEqual(['name', 'phone']);
  });

  test.each([
    ['role', { role: 'admin' }],
    ['email', { email: 'evil@example.com' }],
    ['password', { password: 'newpass1' }],
    ['_id', { _id: 'abc' }],
    ['addresses', { addresses: [] }],
    ['passwordResetTokenHash', { passwordResetTokenHash: 'x' }]
  ])('%s is refused, nothing is saved', async (field, body) => {
    const r = await call(body);
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(r.error.message).toContain(field);
    expect(r.user.save).not.toHaveBeenCalled();
    expect(r.user.role).toBe('customer');
  });

  test('role smuggled in next to valid fields rejects the WHOLE request', async () => {
    const r = await call({ name: 'Hacker', role: 'admin' });
    expect(r.error.statusCode).toBe(400);
    expect(r.user.name).toBe('Sneha');
    expect(r.user.role).toBe('customer');
    expect(r.user.save).not.toHaveBeenCalled();
  });

  test('error message names fields but never echoes their values', async () => {
    const r = await call({ password: 'SuperSecret999' });
    expect(r.error.message).not.toContain('SuperSecret999');
  });
});

describe('validation', () => {
  test.each([
    ['name too short', { name: 'A' }, 'Name must be between 2 and 60 characters'],
    ['name only spaces', { name: '    ' }, 'Name must be between 2 and 60 characters'],
    ['name too long', { name: 'x'.repeat(61) }, 'Name must be between 2 and 60 characters'],
    ['phone letters', { phone: 'abcdefghij' }, 'Phone number must be 10 digits'],
    ['phone 9 digits', { phone: '987654321' }, 'Phone number must be 10 digits'],
    ['phone 11 digits', { phone: '98765432101' }, 'Phone number must be 10 digits'],
    ['empty object', {}, 'Nothing to update']
  ])('%s -> 400', async (_l, body, message) => {
    const r = await call(body);
    expect(r.error).toMatchObject({ statusCode: 400, message });
    expect(r.user.save).not.toHaveBeenCalled();
  });

  test.each([
    [{ name: { $gt: '' } }], [{ name: ['a', 'b'] }], [{ name: 12345 }], [{ phone: 9876543210 }], [{ phone: { $ne: null } }], [{ phone: null }]
  ])('non-text value %j -> 400 Invalid input', async body => {
    const r = await call(body);
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid input' });
    expect(r.user.save).not.toHaveBeenCalled();
  });

  test.each([[null], [undefined], ['text'], [[1, 2]]])('body %j -> 400', async body => {
    const r = await call(body);
    expect(r.error).toMatchObject({ statusCode: 400 });
  });
});

describe('route wiring', () => {
  test('PUT /me exists and is behind protect', () => {
    const router = require('../../routes/authRoutes');
    const layer = router.stack.find(l => l.route && l.route.path === '/me' && l.route.methods.put);
    expect(layer).toBeDefined();
    expect(layer.route.stack[0].name).toBe('protect');
  });
});
