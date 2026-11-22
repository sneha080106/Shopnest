// Production error logging must be useful AND safe: it records that something failed, where, and why,
// without ever writing passwords, tokens, URLs with secrets or email addresses to the log.

const { errorHandler } = require('../../middleware/errorHandler');
const AppError = require('../../utils/AppError');
const { redact, routeOf, describeError, logFatal, registerProcessHandlers } = require('../../utils/logError');

const savedEnv = process.env.NODE_ENV;
let errorSpy;
beforeEach(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { process.env.NODE_ENV = savedEnv; jest.restoreAllMocks(); });

// A request carrying every kind of secret the log must never contain.
const SECRETS = ['SECRETRESETTOKEN', 'hunter2-password', 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEifQ.sigsigsig', 'jane.doe@example.com', 'sk_live_abc123'];
const makeReq = (over = {}) => ({
  method: 'POST',
  originalUrl: `/api/auth/reset-password/${SECRETS[0]}?token=${SECRETS[4]}`,
  baseUrl: '/api/auth',
  route: { path: '/reset-password/:token' },
  params: { token: SECRETS[0] },
  query: { token: SECRETS[4] },
  body: { password: SECRETS[1], email: SECRETS[3] },
  headers: { authorization: `Bearer ${SECRETS[2]}`, cookie: 'session=abc' },
  ...over
});
const makeRes = () => { const res = { status: jest.fn(c => { res.code = c; return res; }), json: jest.fn(b => { res.body = b; return res; }) }; return res; };
const run = (err, req = makeReq()) => { const res = makeRes(); errorHandler(err, req, res, jest.fn()); return res; };
const logged = () => errorSpy.mock.calls.map(c => c.join(' ')).join('\n');

describe('production: 500 errors are logged, safely', () => {
  beforeEach(() => { process.env.NODE_ENV = 'production'; });

  test('writes exactly one JSON line with when / where / what and the same errorId the user sees', () => {
    const res = run(new Error('database exploded'));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(line).toMatchObject({ level: 'error', method: 'POST', status: 500, name: 'Error', message: 'database exploded' });
    expect(line.route).toBe('/api/auth/reset-password/:token'); // the pattern, not the real URL
    expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(line.stack).toContain('database exploded');
    expect(line.errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(res.body.errorId).toBe(line.errorId);
  });

  test('never logs the request body, headers, query, params or the real URL', () => {
    run(new Error('boom'));
    SECRETS.forEach(s => expect(logged()).not.toContain(s));
    expect(logged()).not.toContain('session=abc');
  });

  test('scrubs secrets that appear inside the error message or stack', () => {
    const err = new Error(`connect failed mongodb+srv://admin:p4ssw0rd@cluster0.mongodb.net/shop for ${SECRETS[3]} with Bearer ${SECRETS[2]} and ${SECRETS[2]}`);
    run(err);
    ['p4ssw0rd', SECRETS[3], SECRETS[2]].forEach(s => expect(logged()).not.toContain(s));
    expect(logged()).toContain('mongodb+srv://***@cluster0.mongodb.net');
  });

  test('the response to the user stays generic: no message, no stack, no details', () => {
    const res = run(new Error('secret internal detail'));
    expect(res.code).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Something went wrong. Please try again.', errorId: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });

  test('other 5xx errors are logged too', () => {
    run(new AppError('Service unavailable', 503));
    expect(JSON.parse(errorSpy.mock.calls[0][0])).toMatchObject({ status: 503 });
  });

  test('an error that is not an Error object (a string, null, undefined) is still handled', () => {
    expect(() => run('plain string failure')).not.toThrow();
    expect(() => run(null)).not.toThrow();
    expect(() => run(undefined)).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  test('a request with no matched route (failure before routing) is logged without its URL', () => {
    run(new Error('early'), makeReq({ route: undefined }));
    const line = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(line.route).toBe('[no route]');
    expect(logged()).not.toContain('reset-password');
  });

  test('very long messages are cut off', () => {
    run(new Error('x'.repeat(5000)));
    expect(JSON.parse(errorSpy.mock.calls[0][0]).message.length).toBe(500);
  });
});

describe('production: client errors are not logged and their responses are unchanged', () => {
  beforeEach(() => { process.env.NODE_ENV = 'production'; });

  test.each([
    [new AppError('Bad input', 400), 400, 'Bad input'],
    [new AppError('Nope', 403), 403, 'Nope'],
    [Object.assign(new Error('x'), { name: 'CastError' }), 404, 'Resource not found'],
    [Object.assign(new Error('x'), { code: 11000, keyValue: { email: 'a' } }), 409, 'email already in use'],
    [Object.assign(new Error('x'), { name: 'ValidationError', errors: { a: { message: 'A is required' }, b: { message: 'B is bad' } } }), 400, 'A is required, B is bad']
  ])('%#: status %p', (err, status, message) => {
    const res = run(err);
    expect(res.code).toBe(status);
    expect(res.body).toEqual({ success: false, message });
    expect(res.body.errorId).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('development and test: behaviour is unchanged (full error printed, no errorId needed for 4xx)', () => {
  test.each(['development', 'test'])('NODE_ENV=%s prints the error object itself', env => {
    process.env.NODE_ENV = env;
    const err = new AppError('Bad input', 400);
    const res = run(err);
    expect(errorSpy).toHaveBeenCalledWith(err);
    expect(res.body).toEqual({ success: false, message: 'Bad input' });
  });
});

describe('redact', () => {
  test.each([
    ['mongodb://user:pw@host:27017/db', 'mongodb://***@host:27017/db'],
    ['mongodb+srv://a:b@c.net', 'mongodb+srv://***@c.net'],
    ['redis://:secret@cache:6379', 'redis://***@cache:6379'],
    ['auth Bearer abc.def-123', 'auth Bearer [hidden]'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEifQ.sig_-1 end', 'jwt [jwt] end'],
    ['mail jane.doe@example.com now', 'mail j***@example.com now'],
    ['GET /x?token=abc123&page=2', 'GET /x?token=[hidden]&page=2'],
    ['nothing secret here', 'nothing secret here']
  ])('%p', (input, expected) => expect(redact(input)).toBe(expected));

  test('non-strings give an empty string', () => {
    expect(redact(undefined)).toBe('');
    expect(redact(5)).toBe('');
  });
});

describe('helpers', () => {
  test('routeOf joins the base path and the route pattern only', () => {
    expect(routeOf({ baseUrl: '/api/orders', route: { path: '/:id/cancel' }, originalUrl: '/api/orders/123/cancel' })).toBe('/api/orders/:id/cancel');
    expect(routeOf({})).toBe('[no route]');
    expect(routeOf(undefined)).toBe('[no route]');
  });

  test('describeError tolerates odd values and keeps only name, code, message and stack', () => {
    expect(describeError({ name: 'MongoServerError', code: 11000, message: 'dup', extra: 'ignored', request: { body: 'x' } }))
      .toEqual({ name: 'MongoServerError', code: 11000, message: 'dup', stack: undefined });
    expect(describeError('text')).toMatchObject({ name: 'string', message: 'text' });
  });
});

describe('crashes outside a request', () => {
  test('logFatal writes one scrubbed JSON line', () => {
    logFatal('unhandledRejection', new Error('lost mongodb://u:pw@h/db'));
    const line = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(line).toMatchObject({ level: 'fatal', event: 'unhandledRejection' });
    expect(logged()).not.toContain('pw@');
  });

  test('registerProcessHandlers logs and then exits with code 1 on both kinds of crash', () => {
    const handlers = {};
    const proc = { on: jest.fn((event, fn) => { handlers[event] = fn; }), exit: jest.fn() };
    registerProcessHandlers(proc);
    expect(Object.keys(handlers).sort()).toEqual(['uncaughtException', 'unhandledRejection']);

    handlers.unhandledRejection(new Error('promise failed'));
    expect(JSON.parse(errorSpy.mock.calls[0][0])).toMatchObject({ event: 'unhandledRejection', message: 'promise failed' });
    expect(proc.exit).toHaveBeenLastCalledWith(1);

    handlers.uncaughtException(new Error('thrown'));
    expect(JSON.parse(errorSpy.mock.calls[1][0])).toMatchObject({ event: 'uncaughtException' });
    expect(proc.exit).toHaveBeenCalledTimes(2);
  });

  test('the server registers these handlers only when it actually starts (not when imported by tests)', () => {
    const before = process.listenerCount('uncaughtException');
    jest.isolateModules(() => { process.env.NODE_ENV = 'test'; require('../../server'); });
    expect(process.listenerCount('uncaughtException')).toBe(before);
  });
});
