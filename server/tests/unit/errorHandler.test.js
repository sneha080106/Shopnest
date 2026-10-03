const { errorHandler, notFound } = require('../../middleware/errorHandler');
const AppError = require('../../utils/AppError');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('errorHandler', () => {
  test('uses the status code and message from an AppError as-is', () => {
    const res = mockRes();
    errorHandler(new AppError('Address not found', 404), {}, res, () => {});
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Address not found' });
  });

  test('never leaks the real message for an unhandled 500 — always the generic one', () => {
    const res = mockRes();
    errorHandler(new Error('ECONNREFUSED 127.0.0.1:27017'), {}, res, () => {});
    expect(res.status).toHaveBeenCalledWith(500);
    const [payload] = res.json.mock.calls[0];
    expect(payload.message).toBe('Something went wrong. Please try again.');
    expect(payload.message).not.toMatch(/ECONNREFUSED/);
  });

  test('maps a Mongoose CastError (malformed ObjectId) to a 404, not a 500', () => {
    const res = mockRes();
    const castErr = new Error('Cast to ObjectId failed');
    castErr.name = 'CastError';
    errorHandler(castErr, {}, res, () => {});
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('maps a Mongo duplicate-key error (11000) to a 409 naming the conflicting field', () => {
    const res = mockRes();
    const dupErr = new Error('duplicate key');
    dupErr.code = 11000;
    dupErr.keyValue = { email: 'sneha@example.com' };
    errorHandler(dupErr, {}, res, () => {});
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toMatch(/email/i);
  });

  test('maps a Mongoose ValidationError to 400 with the field messages joined', () => {
    const res = mockRes();
    const validationErr = new Error('Validation failed');
    validationErr.name = 'ValidationError';
    validationErr.errors = { stock: { message: 'Stock must be a non-negative whole number' } };
    errorHandler(validationErr, {}, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Stock must be/);
  });

  test('notFound responds 404 for any unmatched route', () => {
    const res = mockRes();
    notFound({ originalUrl: '/api/does-not-exist' }, res, () => {});
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
