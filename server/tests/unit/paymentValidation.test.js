const { simulatePayment } = require('../../controllers/paymentController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('simulatePayment', () => {
  test('rejects an unrecognized payment method', async () => {
    const next = jest.fn();
    await simulatePayment({ body: { method: 'PayPal' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  test('rejects Demo Card unless the number matches the fixed demo card exactly', async () => {
    const next = jest.fn();
    await simulatePayment(
      { body: { method: 'Demo Card', card: { name: 'Sneha', number: '4111 1111 1111 1112', expiry: '12/30', cvv: '123' } } },
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  test('rejects a Demo Card CVV that is not 3-4 digits', async () => {
    const next = jest.fn();
    await simulatePayment(
      { body: { method: 'Demo Card', card: { name: 'Sneha', number: '4111 1111 1111 1111', expiry: '12/30', cvv: '12' } } },
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  test('accepts the exact demo card number and returns a transaction id', async () => {
    const res = mockRes();
    await simulatePayment(
      { body: { method: 'Demo Card', card: { name: 'Sneha', number: '4111 1111 1111 1111', expiry: '12/30', cvv: '123' } } },
      res,
      jest.fn()
    );
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.transactionId).toMatch(/^TXN/);
    expect(payload.status).toBe('Paid');
  }, 10000);

  test('rejects Demo UPI without an "@" in the UPI id', async () => {
    const next = jest.fn();
    await simulatePayment({ body: { method: 'Demo UPI', upiId: 'notanupiid' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  test('Cash on Delivery needs no card/UPI details and comes back "Pending", not "Paid"', async () => {
    const res = mockRes();
    await simulatePayment({ body: { method: 'Cash on Delivery' } }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.status).toBe('Pending');
  }, 10000);
});
