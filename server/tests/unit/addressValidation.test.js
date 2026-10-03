const { validateAddress } = require('../../controllers/addressController');

const validAddress = {
  fullName: 'Sneha Rao',
  phone: '9876543210',
  houseNumber: '12B',
  street: 'MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001'
};

describe('validateAddress', () => {
  test('accepts a fully-filled, correctly formatted address', () => {
    expect(validateAddress(validAddress)).toBeNull();
  });

  test.each(['fullName', 'phone', 'houseNumber', 'street', 'city', 'state', 'pincode'])(
    'rejects a missing %s',
    field => {
      const { [field]: _omit, ...rest } = validAddress;
      const error = validateAddress(rest);
      expect(error).toMatch(new RegExp(field));
    }
  );

  test('rejects a phone number that is not exactly 10 digits', () => {
    expect(validateAddress({ ...validAddress, phone: '98765' })).toBe('Phone number must be 10 digits');
    expect(validateAddress({ ...validAddress, phone: '987654321099' })).toBe('Phone number must be 10 digits');
  });

  test('rejects a pincode that is not exactly 6 digits', () => {
    expect(validateAddress({ ...validAddress, pincode: '5600' })).toBe('Pincode must be 6 digits');
  });

  test('rejects whitespace-only fields, not just missing ones', () => {
    expect(validateAddress({ ...validAddress, city: '   ' })).toBe('city is required');
  });
});
