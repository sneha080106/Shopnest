// "jane.doe@example.com" -> "j***@example.com", so logs can say who an email was for without
// storing the whole address. Anything that does not look like an address is fully hidden.
function maskEmail(value) {
  if (typeof value !== 'string') return '[hidden]';
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return '[hidden]';
  return `${value[0]}***${value.slice(at)}`;
}

module.exports = { maskEmail };
