const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  resolveAdminPassword,
  getPasswordWeaknesses,
  AdminSeedConfigError,
  ENV_EXAMPLE_PLACEHOLDER,
  DEV_ONLY_DEFAULT_PASSWORD
} = require('../../utils/adminSeedConfig');

const SERVER_DIR = path.join(__dirname, '..', '..');
const REPO_DIR = path.join(SERVER_DIR, '..');
const SEED_PATH = path.join(SERVER_DIR, 'seed', 'seed.js');

// Test fixture assembled from pieces; not a real credential.
const STRONG = ['Vq', '7#', 'mZ', '2$', 'Lr', '9!', 'Xt', '4%'].join('');
const LOCAL_URI = 'mongodb://127.0.0.1:27017/shopnest_test';

describe('resolveAdminPassword - production / strict environments', () => {
  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace only', '   ']
  ])('production + %s ADMIN_PASSWORD throws', (_label, value) => {
    const env = { NODE_ENV: 'production', MONGO_URI: LOCAL_URI };
    if (value !== undefined) env.ADMIN_PASSWORD = value;
    expect(() => resolveAdminPassword(env)).toThrow(AdminSeedConfigError);
    expect(() => resolveAdminPassword(env)).toThrow(/ADMIN_PASSWORD is required/);
  });

  test.each([
    ['too short', 'Ab1!xy'],
    ['no uppercase', 'vq7#mz2$lr9!xt4%'],
    ['no lowercase', 'VQ7#MZ2$LR9!XT4%'],
    ['no digit', 'Vq#mZ$Lr!Xt%Kp&'],
    ['no symbol', 'Vq7mZ2Lr9Xt4Kp8'],
    ['contains "admin"', 'Xq7#Admin2$Lr9!'],
    ['contains "password"', 'Vq7#Password2$Lr'],
    ['contains a sequence', 'Vq7#mZ12345$Lr9!'],
    ['repeated characters', 'Vq7#mZ2$Lrrrr9!Xt']
  ])('production + weak password (%s) throws', (_label, weak) => {
    const env = { NODE_ENV: 'production', ADMIN_PASSWORD: weak };
    expect(() => resolveAdminPassword(env)).toThrow(AdminSeedConfigError);
    expect(() => resolveAdminPassword(env)).toThrow(/too weak/);
  });

  test('production rejects the dev-only default and the .env.example placeholder', () => {
    expect(() => resolveAdminPassword({ NODE_ENV: 'production', ADMIN_PASSWORD: DEV_ONLY_DEFAULT_PASSWORD })).toThrow(/too weak/);
    expect(() => resolveAdminPassword({ NODE_ENV: 'production', ADMIN_PASSWORD: ENV_EXAMPLE_PLACEHOLDER })).toThrow(/too weak/);
  });

  test('production + strong password succeeds and returns exactly that password', () => {
    const result = resolveAdminPassword({ NODE_ENV: 'production', ADMIN_PASSWORD: STRONG });
    expect(result).toEqual({ password: STRONG, source: 'env' });
  });

  test.each(['staging', undefined, ''])('NODE_ENV=%p is treated as strict, never as dev', nodeEnv => {
    const env = { MONGO_URI: LOCAL_URI };
    if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
    expect(() => resolveAdminPassword(env)).toThrow(/ADMIN_PASSWORD is required/);
  });

  test('production never returns the dev-only default, whatever else is set', () => {
    const attempts = [
      { NODE_ENV: 'production', MONGO_URI: LOCAL_URI },
      { NODE_ENV: 'production', MONGO_URI: LOCAL_URI, ADMIN_PASSWORD: ENV_EXAMPLE_PLACEHOLDER },
      { NODE_ENV: 'production', MONGO_URI: LOCAL_URI, ADMIN_PASSWORD: STRONG }
    ];
    attempts.forEach(env => {
      let result;
      try { result = resolveAdminPassword(env); } catch (e) { result = null; }
      if (result) expect(result.password).not.toBe(DEV_ONLY_DEFAULT_PASSWORD);
    });
  });

  test('error messages never contain the supplied password', () => {
    ['Ab1!xy', 'vq7#mz2$lr9!xt4%', 'Vq7#Password2$Lr'].forEach(weak => {
      try {
        resolveAdminPassword({ NODE_ENV: 'production', ADMIN_PASSWORD: weak });
        throw new Error('expected resolveAdminPassword to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AdminSeedConfigError);
        expect(err.message).not.toContain(weak);
      }
    });
  });
});

describe('getPasswordWeaknesses', () => {
  test('accepts the strong fixture', () => {
    expect(getPasswordWeaknesses(STRONG)).toEqual([]);
  });
});

describe('resolveAdminPassword - development / test', () => {
  test.each(['development', 'test'])('%s + local DB + no password uses the dev-only default', nodeEnv => {
    const result = resolveAdminPassword({ NODE_ENV: nodeEnv, MONGO_URI: LOCAL_URI });
    expect(result).toEqual({ password: DEV_ONLY_DEFAULT_PASSWORD, source: 'dev-default' });
  });

  test('an explicit ADMIN_PASSWORD is honoured in development', () => {
    const result = resolveAdminPassword({ NODE_ENV: 'development', MONGO_URI: LOCAL_URI, ADMIN_PASSWORD: 'dev-choice-1' });
    expect(result).toEqual({ password: 'dev-choice-1', source: 'env' });
  });

  test('the untouched .env.example placeholder is treated as unset in development', () => {
    const result = resolveAdminPassword({ NODE_ENV: 'development', MONGO_URI: LOCAL_URI, ADMIN_PASSWORD: ENV_EXAMPLE_PLACEHOLDER });
    expect(result.source).toBe('dev-default');
  });

  test.each([
    'mongodb+srv://user:pw@cluster0.example.mongodb.net/shopnest',
    'mongodb://db.internal.example.com:27017/shopnest',
    'mongodb://localhost.evil.example.com/shopnest',
    ''
  ])('dev-only default is refused for non-local database %p', uri => {
    const env = { NODE_ENV: 'development', MONGO_URI: uri };
    expect(() => resolveAdminPassword(env)).toThrow(AdminSeedConfigError);
    expect(() => resolveAdminPassword(env)).toThrow(/non-local database/);
  });

  test('a non-local database is fine in development when ADMIN_PASSWORD is explicitly set', () => {
    const result = resolveAdminPassword({
      NODE_ENV: 'development',
      MONGO_URI: 'mongodb+srv://user:pw@cluster0.example.mongodb.net/shopnest',
      ADMIN_PASSWORD: STRONG
    });
    expect(result.source).toBe('env');
  });
});

// These run the real seed script as a child process with a minimal, explicit environment.
// Every case here aborts (or fails on the missing MONGO_URI) before any database connection
// is attempted, so no MongoDB is required.
describe('seed script (child process)', () => {
  function runSeed(envOverrides) {
    const result = spawnSync(process.execPath, [SEED_PATH], {
      cwd: SERVER_DIR,
      env: { ...envOverrides },
      encoding: 'utf8',
      timeout: 30000
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  test('production + missing ADMIN_PASSWORD fails before connecting', () => {
    const { status, output } = runSeed({ NODE_ENV: 'production', ADMIN_PASSWORD: '', MONGO_URI: '' });
    expect(status).toBe(1);
    expect(output).toMatch(/ADMIN_PASSWORD is required/);
    expect(output).not.toMatch(/MongoDB connected/);
  });

  test('NODE_ENV unset + missing ADMIN_PASSWORD also fails', () => {
    const { status, output } = runSeed({ ADMIN_PASSWORD: '', MONGO_URI: LOCAL_URI });
    expect(status).toBe(1);
    expect(output).toMatch(/ADMIN_PASSWORD is required/);
  });

  test('production + weak ADMIN_PASSWORD fails and does not print the password', () => {
    const weak = 'weakpass';
    const { status, output } = runSeed({ NODE_ENV: 'production', ADMIN_PASSWORD: weak, MONGO_URI: '' });
    expect(status).toBe(1);
    expect(output).toMatch(/too weak/);
    expect(output).not.toContain(weak);
  });

  test('production + strong ADMIN_PASSWORD gets past credential checks and never prints the password', () => {
    // MONGO_URI is deliberately empty, so the run stops at the DB step with a MONGO_URI error.
    // That proves credential validation passed without needing a real database.
    const { status, output } = runSeed({ NODE_ENV: 'production', ADMIN_PASSWORD: STRONG, MONGO_URI: '' });
    expect(status).toBe(1);
    expect(output).toMatch(/MONGO_URI is not set/);
    expect(output).not.toMatch(/ADMIN_PASSWORD is required|too weak/);
    expect(output).not.toContain(STRONG);
  });
});

describe('no known default password in production paths or docs', () => {
  const read = p => fs.readFileSync(p, 'utf8');

  test('seed.js does not contain the dev-only default', () => {
    expect(read(SEED_PATH)).not.toContain(DEV_ONLY_DEFAULT_PASSWORD);
  });

  test('.env.example and README do not contain the dev-only default', () => {
    expect(read(path.join(SERVER_DIR, '.env.example'))).not.toContain(DEV_ONLY_DEFAULT_PASSWORD);
    expect(read(path.join(REPO_DIR, 'README.md'))).not.toContain(DEV_ONLY_DEFAULT_PASSWORD);
  });

  test('.env.example uses the placeholder, which production rejects', () => {
    expect(read(path.join(SERVER_DIR, '.env.example'))).toMatch(
      new RegExp(`^ADMIN_PASSWORD=${ENV_EXAMPLE_PLACEHOLDER}$`, 'm')
    );
    expect(() => resolveAdminPassword({ NODE_ENV: 'production', ADMIN_PASSWORD: ENV_EXAMPLE_PLACEHOLDER })).toThrow(/too weak/);
  });

  test('the dev-only default appears in exactly one source file: utils/adminSeedConfig.js', () => {
    const skip = new Set(['node_modules', '.git', 'dist']);
    const hits = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name) || entry.name === 'package-lock.json') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (read(full).includes(DEV_ONLY_DEFAULT_PASSWORD)) hits.push(path.relative(REPO_DIR, full));
      }
    })(REPO_DIR);
    expect(hits).toEqual([path.join('server', 'utils', 'adminSeedConfig.js')]);
  });
});
