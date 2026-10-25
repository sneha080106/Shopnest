// Auth endpoints must reject non-text input (e.g. { "email": { "$gt": "" } }) before any query.
// Real controller, mocked User model (no MongoDB).

jest.mock('../../models/User', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('../../utils/sendEmail', () => jest.fn(async () => ({ sent: false, error: 'off' })));

const User = require('../../models/User');
const { register, login, forgotPassword, resetPassword } = require('../../controllers/authController');

beforeEach(() => { User.findOne.mockReset(); User.create.mockReset(); });

async function call(handler, { body = {}, params = {} } = {}) {
  const res = { status: jest.fn(() => res), json: jest.fn() };
  const next = jest.fn();
  await handler({ body, params }, res, next);
  return { error: next.mock.calls[0]?.[0], res };
}

const BAD = [{ $gt: '' }, { $ne: null }, ['a@b.co'], 12345, true];

describe('login', () => {
  test.each(BAD.map(v => [JSON.stringify(v), v]))('email %s -> 400, user table never queried', async (_l, v) => {
    const r = await call(login, { body: { email: v, password: 'secret1' } });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid input' });
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test.each(BAD.map(v => [JSON.stringify(v), v]))('password %s -> 400, user table never queried', async (_l, v) => {
    const r = await call(login, { body: { email: 'a@b.co', password: v } });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid input' });
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('the classic bypass { email: {$gt:""}, password: {$gt:""} } is rejected', async () => {
    const r = await call(login, { body: { email: { $gt: '' }, password: { $gt: '' } } });
    expect(r.error.statusCode).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('missing fields keep the original message; valid text goes on to the lookup', async () => {
    expect((await call(login, { body: {} })).error).toMatchObject({ statusCode: 400, message: 'Please provide email and password' });
    User.findOne.mockReturnValue({ select: () => Promise.resolve(null) });
    const r = await call(login, { body: { email: 'A@B.co', password: 'secret1' } });
    expect(User.findOne).toHaveBeenCalledWith({ email: 'a@b.co' });
    expect(r.error).toMatchObject({ statusCode: 401, message: 'Invalid email or password' });
  });
});

describe('register', () => {
  const ok = { name: 'Sneha', email: 'a@b.co', password: 'secret1', confirmPassword: 'secret1' };

  test.each([['name'], ['email'], ['password'], ['confirmPassword'], ['phone']])('%s as an object -> 400, nothing created', async field => {
    const r = await call(register, { body: { ...ok, [field]: { $ne: 'x' } } });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(User.findOne).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });

  test('a normal registration still reaches the duplicate check and create', async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue({ _id: 'u1', toSafeObject: () => ({ _id: 'u1' }) });
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    const r = await call(register, { body: { ...ok, phone: '9999999999' } });
    expect(r.error).toBeUndefined();
    expect(User.create).toHaveBeenCalled();
  });

  test('existing validation messages are unchanged', async () => {
    expect((await call(register, { body: { ...ok, password: '123', confirmPassword: '123' } })).error.message).toBe('Password must be at least 6 characters');
    expect((await call(register, { body: { ...ok, confirmPassword: 'other1' } })).error.message).toBe('Passwords do not match');
    expect((await call(register, { body: { ...ok, email: 'nope' } })).error.message).toBe('Please enter a valid email address');
  });
});

describe('forgot / reset password', () => {
  test.each(BAD.map(v => [JSON.stringify(v), v]))('forgot-password email %s -> 400, no lookup', async (_l, v) => {
    const r = await call(forgotPassword, { body: { email: v } });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid input' });
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('forgot-password still answers generically for an unknown email', async () => {
    User.findOne.mockResolvedValue(null);
    const r = await call(forgotPassword, { body: { email: 'nobody@x.co' } });
    expect(r.error).toBeUndefined();
    expect(r.res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test.each([[{ $ne: 1 }, 'secret1'], ['secret1', ['secret1']], [{ a: 1 }, { a: 1 }]])('reset-password with non-text %p / %p -> 400', async (password, confirmPassword) => {
    const r = await call(resetPassword, { params: { token: 'abc' }, body: { password, confirmPassword } });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid input' });
    expect(User.findOne).not.toHaveBeenCalled();
  });
});
