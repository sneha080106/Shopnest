// TRUST_PROXY parsing, and its effect on per-IP rate limiting through the real Express app
// (supertest; no database is touched - the requests are rejected by validation with a 400).

const { parseTrustProxy } = require('../../utils/trustProxy');

describe('parseTrustProxy', () => {
  test.each([[undefined], [null], [''], ['  '], ['false'], ['FALSE'], ['0']])('%p -> false (no proxy)', v => {
    expect(parseTrustProxy(v)).toBe(false);
  });

  test.each([['1', 1], ['2', 2], [' 1 ', 1], ['10', 10]])('%p -> %p hops', (v, n) => {
    expect(parseTrustProxy(v)).toBe(n);
  });

  test.each([['true'], ['TRUE'], ['11'], ['-1'], ['1.5'], ['abc'], ['loopback'], ['1,2'], ['0x1']])(
    '%p is rejected (never "trust everything")', v => {
      expect(() => parseTrustProxy(v)).toThrow(/TRUST_PROXY/);
    }
  );
});

// Loads a fresh copy of the app with the given env, so rate-limit settings are read at that moment.
function loadApp(env) {
  const saved = { ...process.env };
  Object.assign(process.env, { NODE_ENV: 'test', RATE_LIMIT_AUTH_MAX: '2', RATE_LIMIT_WINDOW_MINUTES: '15' });
  delete process.env.TRUST_PROXY;
  Object.assign(process.env, env);
  let app;
  jest.isolateModules(() => { app = require('../../server'); });
  process.env = saved;
  return app;
}

const request = require('supertest');
const hit = (app, xff) => request(app).post('/api/auth/login').set('X-Forwarded-For', xff).send({});

describe('rate limiting and X-Forwarded-For', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {})); // express-rate-limit logs a config warning
  afterEach(() => jest.restoreAllMocks());

  test('the app reads TRUST_PROXY (default: off)', () => {
    expect(loadApp({}).get('trust proxy')).toBe(false);
    expect(loadApp({ TRUST_PROXY: '1' }).get('trust proxy')).toBe(1);
  });

  test('an invalid TRUST_PROXY stops the app from loading', () => {
    expect(() => loadApp({ TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
  });

  test('behind a proxy WITHOUT the setting, everyone shares one bucket (the problem being fixed)', async () => {
    const app = loadApp({});
    expect((await hit(app, '1.1.1.1')).status).toBe(400);
    expect((await hit(app, '2.2.2.2')).status).toBe(400);
    expect((await hit(app, '3.3.3.3')).status).toBe(429); // different real users, already limited
  });

  test('with TRUST_PROXY=1, different real client addresses get separate buckets', async () => {
    const app = loadApp({ TRUST_PROXY: '1' });
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4']) {
      expect((await hit(app, ip)).status).toBe(400);
    }
  });

  test('with TRUST_PROXY=1, a client cannot dodge the limit by forging extra X-Forwarded-For entries', async () => {
    const app = loadApp({ TRUST_PROXY: '1' });
    // The proxy appends the real address (9.9.9.9) last; the leading entries are the client's lies.
    expect((await hit(app, 'fake1, 9.9.9.9')).status).toBe(400);
    expect((await hit(app, 'fake2, 9.9.9.9')).status).toBe(400);
    expect((await hit(app, 'fake3, 9.9.9.9')).status).toBe(429);
  });

  test('the limit itself still applies per client', async () => {
    const app = loadApp({ TRUST_PROXY: '1' });
    await hit(app, '5.5.5.5'); await hit(app, '5.5.5.5');
    expect((await hit(app, '5.5.5.5')).status).toBe(429);
    expect((await hit(app, '6.6.6.6')).status).toBe(400);
  });
});
