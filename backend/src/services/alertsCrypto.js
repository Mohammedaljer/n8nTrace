const crypto = require('crypto');
const { ALERTS_SECRET_KEY } = require('../config');

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;

  const raw = (ALERTS_SECRET_KEY || '').trim();
  if (!raw) return null;

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    cachedKey = Buffer.from(raw, 'hex');
    return cachedKey;
  }

  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) {
      cachedKey = decoded;
      return cachedKey;
    }
  } catch {
    return null;
  }

  return null;
}

function encryptSecret(plainText) {
  if (!plainText) return null;
  const key = getKey();
  if (!key) throw new Error('ALERTS_SECRET_KEY is not configured');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptSecret(cipherText) {
  if (!cipherText) return null;
  const key = getKey();
  if (!key) throw new Error('ALERTS_SECRET_KEY is not configured');

  const parts = String(cipherText).split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted secret format');

  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
}

function maskSecret(secretValue) {
  if (!secretValue) return null;
  const text = String(secretValue);
  if (text.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  maskSecret,
};
