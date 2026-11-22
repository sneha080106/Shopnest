// Safe error logging for production.
//
// The old error handler logged nothing in production, so a 500 left no trace. Logging the raw error
// or request would be worse: URLs hold password-reset tokens, bodies hold passwords, headers hold
// JWTs, and error messages can echo connection strings or email addresses. So this logs only:
//   when, which route PATTERN (not the real URL), the status, the error's name/code, and its
//   message and stack with secrets scrubbed - never the request body, headers, query string or params.

const crypto = require('crypto');
const { maskEmail } = require('./maskEmail');

const MAX_MESSAGE = 500;
const MAX_STACK = 3000;

// Scrubs anything that looks like a credential out of free text (error messages, stack traces).
function redact(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\b(mongodb(?:\+srv)?|redis|postgres(?:ql)?|mysql|amqp):\/\/[^\s/@]*@/gi, '$1://***@') // user:password@ in connection strings
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')                                              // JSON Web Tokens
    .replace(/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer [hidden]')                                        // Authorization headers
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, email => maskEmail(email))                       // email addresses
    .replace(/([?&](?:token|password|secret|key)=)[^&\s]+/gi, '$1[hidden]');                       // query-string secrets
}

const newErrorId = () => crypto.randomBytes(4).toString('hex');

// "/api/auth/reset-password/:token" - the route pattern Express matched, never the real values.
function routeOf(req) {
  const pattern = req && req.route && typeof req.route.path === 'string' ? req.route.path : null;
  if (!pattern) return '[no route]';
  return `${(req.baseUrl || '')}${pattern}`;
}

function describeError(err) {
  const isObject = err !== null && typeof err === 'object';
  const message = isObject ? err.message : err;
  return {
    name: isObject && typeof err.name === 'string' ? err.name : typeof err,
    code: isObject && (typeof err.code === 'string' || typeof err.code === 'number') ? err.code : undefined,
    message: redact(String(message ?? '')).slice(0, MAX_MESSAGE),
    stack: isObject && typeof err.stack === 'string' ? redact(err.stack).slice(0, MAX_STACK) : undefined
  };
}

// One JSON line per error: easy for log tools (and people) to search; errorId matches the id the user was shown.
function logServerError(err, req, statusCode, errorId) {
  console.error(JSON.stringify({
    level: 'error',
    time: new Date().toISOString(),
    errorId,
    method: req && req.method,
    route: routeOf(req),
    status: statusCode,
    ...describeError(err)
  }));
}

// For errors outside any request (crashes, unhandled promise rejections).
function logFatal(label, err) {
  console.error(JSON.stringify({ level: 'fatal', time: new Date().toISOString(), event: label, ...describeError(err) }));
}

// After a crash-level error the process state can't be trusted, so log it and exit: the host
// (Render, Railway, pm2, Docker...) restarts a clean process. Takes the process object so it can be tested.
function registerProcessHandlers(proc = process) {
  proc.on('unhandledRejection', reason => { logFatal('unhandledRejection', reason); proc.exit(1); });
  proc.on('uncaughtException', err => { logFatal('uncaughtException', err); proc.exit(1); });
}

module.exports = { redact, newErrorId, routeOf, describeError, logServerError, logFatal, registerProcessHandlers };
