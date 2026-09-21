/**
 * Centralized validation helpers for the Society Management API.
 *
 * These mirror the frontend validation rules (web `src/utils/validators.js`
 * and mobile `src/utils/validators.js`) so that server-side validation acts
 * as a consistent final safety layer. Rules are stored in Redis/DB later;
 * for now they are plain functions returning boolean or error messages.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;

/**
 * Normalize a text value: trim + collapse internal whitespace.
 */
const sanitizeText = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
};

const isEmpty = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
};

const isValidEmail = (email) =>
  typeof email === 'string' && EMAIL_REGEX.test(email.trim());

const isValidMobile = (mobile) => {
  if (typeof mobile !== 'string') return false;
  return INDIAN_MOBILE_REGEX.test(mobile.replace(/\s/g, ''));
};

/**
 * Validate a title/name field (>= 4 chars, not numbers-only,
 * not special-characters-only, no excessive whitespace).
 */
const isValidTitle = (value) => {
  if (isEmpty(value) || typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 4) return false;
  if (/^\d+$/.test(v)) return false;
  if (/^[\W_]+$/.test(v)) return false;
  if (/\s{2,}/.test(v)) return false;
  return true;
};

const isValidPersonName = (value) => {
  if (isEmpty(value) || typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 2) return false;
  if (/\d/.test(v)) return false;
  if (!/^[A-Za-z]+(?:[ .'-][A-Za-z]+)*$/.test(v)) return false;
  return true;
};

const isPositiveNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
};

const isNonNegativeNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
};

const isValidISODate = (value) => {
  if (typeof value !== 'string' || !value) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(mo) - 1 &&
    date.getUTCDate() === Number(d)
  );
};

const isValidVehicleNumber = (value) => {
  if (typeof value !== 'string') return false;
  return /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(
    value.trim().toUpperCase().replace(/\s/g, '')
  );
};

/**
 * Collect the first missing/invalid required field.
 * @param {object} body - request body
 * @param {Array<[string, function]>} rules - [fieldKey, validatorFn]
 * @returns {string|null} e.g. "name is required" or "email is invalid"
 */
const findFirstError = (body, rules) => {
  for (const [field, validator] of rules) {
    const value = body[field];
    if (isEmpty(value)) return `${field} is required`;
    if (validator && !validator(value)) return `${field} is invalid`;
  }
  return null;
};

module.exports = {
  sanitizeText,
  isEmpty,
  isValidEmail,
  isValidMobile,
  isValidTitle,
  isValidPersonName,
  isValidPassword: (p) => typeof p === 'string' && PASSWORD_REGEX.test(p),
  isPositiveNumber,
  isNonNegativeNumber,
  isValidISODate,
  isValidVehicleNumber,
  findFirstError,
};