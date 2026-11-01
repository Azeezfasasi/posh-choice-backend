// Escape user-supplied text before interpolating it into email HTML
const escapeHtml = (value) => {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// Escape user-supplied text before using it inside a RegExp
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Copy only the listed keys that are present in source
const pick = (source, keys) => {
  const result = {};
  for (const key of keys) {
    if (source && source[key] !== undefined) result[key] = source[key];
  }
  return result;
};

module.exports = { escapeHtml, escapeRegex, pick };
