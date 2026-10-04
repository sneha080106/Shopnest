'use strict';

// Resolves the admin password used by the seed script.
//
// Rules:
//  - Only an explicit NODE_ENV of "development" or "test" is treated as a dev environment.
//    Anything else (production, staging, or NODE_ENV unset) is treated as strict, so a
//    misconfigured deploy can never fall through to the dev convenience default.
//  - In strict environments ADMIN_PASSWORD is required and must pass the strength policy.
//  - In dev/test, a missing ADMIN_PASSWORD falls back to a well-known dev-only password, but
//    only when MONGO_URI points at a local database.
//  - Neither the password nor any part of it is ever included in an error message.

const ENV_EXAMPLE_PLACEHOLDER = 'replace-with-a-strong-password';

// DEV/TEST ONLY. Never returned in a strict environment or against a non-local database.
const DEV_ONLY_DEFAULT_PASSWORD = 'Admin@12345';

const MIN_LENGTH = 12;
const WEAK_SUBSTRINGS = ['password', 'admin', 'shopnest', 'qwerty', 'letmein', 'welcome', '12345', 'abcde'];
const LOCAL_MONGO_URI = /^mongodb:\/\/(?:[^@/]*@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?]|$)/i;

class AdminSeedConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminSeedConfigError';
  }
}

function isDevLikeEnvironment(env) {
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}

// Returns a list of static, value-free descriptions of what is wrong. Empty list = acceptable.
function getPasswordWeaknesses(password) {
  const problems = [];
  if (password.length < MIN_LENGTH) problems.push(`must be at least ${MIN_LENGTH} characters`);
  if (!/[a-z]/.test(password)) problems.push('must contain a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('must contain an uppercase letter');
  if (!/[0-9]/.test(password)) problems.push('must contain a digit');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('must contain a symbol');
  if (/(.)\1{3,}/.test(password)) problems.push('must not repeat the same character 4 or more times in a row');
  const lower = password.toLowerCase();
  if (WEAK_SUBSTRINGS.some(s => lower.includes(s))) {
    problems.push('must not contain common or predictable words/sequences');
  }
  return problems;
}

function resolveAdminPassword(env = process.env) {
  const raw = env.ADMIN_PASSWORD;
  const provided = typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;

  if (!isDevLikeEnvironment(env)) {
    const label = env.NODE_ENV || 'unset';
    if (!provided) {
      throw new AdminSeedConfigError(
        `ADMIN_PASSWORD is required when NODE_ENV is "${label}". Set it to a strong, unique password; there is no default.`
      );
    }
    const problems = getPasswordWeaknesses(provided);
    if (problems.length > 0) {
      throw new AdminSeedConfigError(`ADMIN_PASSWORD is too weak: it ${problems.join('; it ')}.`);
    }
    return { password: provided, source: 'env' };
  }

  // development / test
  if (provided && provided !== ENV_EXAMPLE_PLACEHOLDER) {
    return { password: provided, source: 'env' };
  }
  if (!LOCAL_MONGO_URI.test(env.MONGO_URI || '')) {
    throw new AdminSeedConfigError(
      'ADMIN_PASSWORD must be set to a real password when seeding a non-local database, even if NODE_ENV is development or test.'
    );
  }
  return { password: DEV_ONLY_DEFAULT_PASSWORD, source: 'dev-default' };
}

module.exports = {
  resolveAdminPassword,
  getPasswordWeaknesses,
  AdminSeedConfigError,
  ENV_EXAMPLE_PLACEHOLDER,
  DEV_ONLY_DEFAULT_PASSWORD,
  MIN_LENGTH
};
