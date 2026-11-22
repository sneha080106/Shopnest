const { newErrorId, logServerError } = require('../utils/logError');

function notFound(req, res, next) {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // next(null) / next(undefined) never reach here, but a thrown null or string can.
  if (err === null || err === undefined) err = new Error('Unknown error');
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Something went wrong. Please try again.';

  if (err.name === 'CastError') {
    statusCode = 404;
    message = 'Resource not found';
  }
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0];
    message = `${field ? field : 'Value'} already in use`;
  }
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map(e => e.message).join(', ');
  }

  // Server errors (5xx) get an id that is both logged and shown to the user, so a bug report
  // ("error 3fa9c1d2") can be matched to the log line without exposing any details.
  const errorId = statusCode >= 500 ? newErrorId() : undefined;

  if (process.env.NODE_ENV !== 'production') {
    console.error(err); // development: the full error, as before
  } else if (errorId) {
    logServerError(err, req, statusCode, errorId); // production: one scrubbed line, 5xx only
  }

  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Something went wrong. Please try again.' : message,
    ...(errorId && { errorId })
  });
}

module.exports = { notFound, errorHandler };
