// Logs must not contain credentials or full email addresses.

jest.mock('../../models/User', () => ({ findOne: jest.fn() }));
jest.mock('../../utils/sendEmail', () => jest.fn(async () => ({ sent: false, error: 'SMTP down' })));

const User = require('../../models/User');
const { forgotPassword } = require('../../controllers/authController');
const { maskEmail } = require('../../utils/maskEmail');

describe('maskEmail', () => {
  test('keeps the first letter and the domain only', () => {
    expect(maskEmail('jane.doe@example.com')).toBe('j***@example.com');
    expect(maskEmail('a@b.co')).toBe('a***@b.co');
  });
  test.each([[''], ['nope'], ['@x.com'], ['a@'], [null], [undefined], [{ a: 1 }], [42]])('%p is fully hidden', v => {
    expect(maskEmail(v)).toBe('[hidden]');
  });
});

describe('password reset email failure', () => {
  const RAW_TOKEN = 'RAWTOKEN-abc123';
  const EMAIL = 'jane.doe@example.com';
  let warn;
  const saved = process.env.NODE_ENV;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    User.findOne.mockResolvedValue({
      _id: 'user-42', email: EMAIL, createPasswordResetToken: () => RAW_TOKEN, save: jest.fn(async () => {})
    });
  });
  afterEach(() => { process.env.NODE_ENV = saved; jest.restoreAllMocks(); });

  async function run() {
    const res = { json: jest.fn() };
    await forgotPassword({ body: { email: EMAIL } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true })); // response unchanged
    return warn.mock.calls.map(c => c.join(' ')).join('\n');
  }

  test.each(['production', 'test', 'staging', undefined])('NODE_ENV=%p: the reset link/token and the email address are NOT logged', async env => {
    if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
    const logged = await run();
    expect(logged).not.toContain(RAW_TOKEN);
    expect(logged).not.toContain('reset-password');
    expect(logged).not.toContain(EMAIL);
    expect(logged).toContain('user-42');
    expect(logged).toContain('SMTP down');
  });

  test('NODE_ENV=development: the link is logged so local testing still works, still without the email address', async () => {
    process.env.NODE_ENV = 'development';
    const logged = await run();
    expect(logged).toContain(`/reset-password/${RAW_TOKEN}`);
    expect(logged).toContain('local development only');
    expect(logged).not.toContain(EMAIL);
  });
});

describe('sendEmail skip message', () => {
  test('does not print the full recipient address', async () => {
    jest.resetModules();
    jest.unmock('../../utils/sendEmail');
    const saved = { ...process.env };
    delete process.env.EMAIL_HOST; delete process.env.EMAIL_USER; delete process.env.EMAIL_PASSWORD;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const realSendEmail = jest.requireActual('../../utils/sendEmail');
    const result = await realSendEmail({ to: 'jane.doe@example.com', subject: 'Hello', html: '' });
    const logged = warn.mock.calls.map(c => c.join(' ')).join('\n');
    expect(result).toEqual({ sent: false, error: 'Email not configured' });
    expect(logged).toContain('j***@example.com');
    expect(logged).not.toContain('jane.doe@example.com');
    process.env = saved;
    warn.mockRestore();
  });
});
