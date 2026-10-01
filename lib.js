/**
 * Link Expander — the link format.
 *
 * A generated link looks like this:
 *
 *   https://linkexpander.thebestmotherfuckingweb.site/<header><payload><padding>
 *
 *   header   3 characters. base36(payload length + LENGTH_OFFSET), letters
 *            randomly upper/lower case, so it never looks like a counter.
 *   payload  base64url of `"<target byte length>\n" + target + seed`, XOR-ed
 *            with a fixed keystream. Carries the destination **and** the seed.
 *   padding  random [A-Za-z0-9] noise, derived from (target, seed) and as long
 *            as needed to hit the exact requested total length.
 *
 * Everything the link needs is inside the link: `parseLink()` recovers the
 * destination and the seed, and `buildLink(target, length, {seed})` rebuilds
 * the very same link, byte for byte. The noise is not a checksum by accident —
 * `parseLink()` also re-derives it, so a link that was edited on the way is
 * reported as `intact: false`.
 *
 * Everything here is DOM-free, so it runs both in the browser and in Node
 * (`npm test`).
 */

/** Canonical origin. Change this if you deploy your own fork somewhere else. */
export const SITE_ORIGIN = 'https://linkexpander.thebestmotherfuckingweb.site';

/** Number of characters reserved for the payload-length header. */
export const LENGTH_PREFIX_CHARS = 3;

/** Random characters that are always appended, so a link never looks meaningful. */
export const MIN_PADDING = 8;

/** Hard cap: browsers, chat clients and mail clients break long before this. */
export const MAX_TOTAL_LENGTH = 8192;

/** Above this we still build the link, but warn that it may get truncated. */
export const SOFT_MAX_LENGTH = 2000;

/** Default total length offered in the UI. */
export const DEFAULT_LENGTH = 128;

/** Length of the seed that is generated when the user leaves the field empty. */
export const DEFAULT_SEED_LENGTH = 5;

/** Longest accepted seed. */
export const MAX_SEED_LENGTH = 64;

/**
 * Added to the payload length before it is written in base 36. Without it,
 * short payloads would all produce headers like "00n", which looks like data.
 */
const LENGTH_OFFSET = 23328;

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const utf8 = new TextEncoder();

function fail(code, meta) {
  const error = new Error(code);
  error.code = code;
  error.meta = meta || {};
  return error;
}

/** `https://example.com` -> `https://example.com/` */
export function baseUrl(origin = SITE_ORIGIN) {
  return String(origin).replace(/\/+$/, '') + '/';
}

/* ------------------------------------------------------------------ targets */

/**
 * Trim the input, add `https://` when no scheme was typed, and keep only
 * http(s) destinations.
 */
export function normalizeTarget(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) throw fail('EMPTY_TARGET');
  const candidate = URL_SCHEME.test(value) ? value : 'https://' + value;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw fail('INVALID_TARGET');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw fail('BAD_SCHEME');
  if (!url.hostname) throw fail('INVALID_TARGET');
  return candidate;
}

/* -------------------------------------------------------------------- seeds */

/** Uniform random integer in [0, max) using the platform CSPRNG. */
export function randomInt(max) {
  if (!(max > 1)) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

function pick(set, rand) {
  return set[rand(set.length)];
}

/** A fresh seed for when the user did not bring one. */
export function randomSeed(length = DEFAULT_SEED_LENGTH, rand = randomInt) {
  let seed = '';
  for (let i = 0; i < length; i++) seed += pick(ALPHANUM, rand);
  return seed;
}

function normalizeSeed(raw, rand) {
  const seed = String(raw == null ? '' : raw).trim();
  if ([...seed].length > MAX_SEED_LENGTH) throw fail('SEED_TOO_LONG', { maximum: MAX_SEED_LENGTH });
  return seed || randomSeed(DEFAULT_SEED_LENGTH, rand);
}

/** 32-bit FNV-1a over UTF-8 bytes: same value in every browser and in Node. */
function hashSeed(text) {
  let hash = 0x811c9dc5;
  for (const byte of utf8.encode(text)) {
    hash = (hash ^ byte) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic xorshift32 stream for one (target, seed, purpose). Same inputs
 * always give the same noise, on any machine, forever.
 */
function seededRandom(...parts) {
  let state = hashSeed(parts.join('\u0000')) || 0x9e3779b9;
  return (max) => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state % max;
  };
}

function shuffled(items, rand) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * `length` characters of meaningless noise. Upper case, lower case and digits
 * are all guaranteed to appear, so the result never looks like a word or a
 * number. Pass a `seededRandom()` stream to make it reproducible.
 */
export function randomPadding(length, rand = randomInt) {
  if (length <= 0) return '';
  const forced = length >= 3 ? [pick(UPPER, rand), pick(LOWER, rand), pick(DIGITS, rand)] : [];
  const rest = [];
  for (let i = forced.length; i < length; i++) rest.push(pick(ALPHANUM, rand));
  return shuffled(forced.concat(rest), rand).join('');
}

/* ------------------------------------------------------------- camouflage */

/**
 * Position-dependent keystream (xorshift32, fixed seed). XOR-ing the payload
 * with it is pure camouflage, not encryption: it stops the middle of a link
 * from looking like an obvious `aHR0cHM6Ly9...` blob, and stops repeated text
 * (a long run of the same character) from showing up as a repeating pattern.
 */
function keystream(length) {
  const stream = new Uint8Array(length);
  let state = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    stream[i] = state & 0xff;
  }
  return stream;
}

function camouflage(bytes) {
  const stream = keystream(bytes.length);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ stream[i];
  return out;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/** `{target, seed}` -> the opaque middle of a link. */
export function encodePayload(target, seed) {
  const targetBytes = utf8.encode(target);
  const seedBytes = utf8.encode(seed);
  const prefix = utf8.encode(`${targetBytes.length}\n`);
  const bytes = new Uint8Array(prefix.length + targetBytes.length + seedBytes.length);
  bytes.set(prefix, 0);
  bytes.set(targetBytes, prefix.length);
  bytes.set(seedBytes, prefix.length + targetBytes.length);
  return bytesToBase64Url(camouflage(bytes));
}

/** The opaque middle -> `{target, seed}`, or `null` if it is not valid. */
export function decodePayload(encoded) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  let bytes;
  try {
    bytes = camouflage(base64UrlToBytes(encoded));
  } catch {
    return null;
  }
  const newline = bytes.indexOf(0x0a);
  if (newline <= 0) return null;
  const declared = new TextDecoder().decode(bytes.subarray(0, newline));
  if (!/^\d{1,6}$/.test(declared)) return null;

  const start = newline + 1;
  const targetLength = Number(declared);
  if (targetLength < 1 || start + targetLength > bytes.length) return null;

  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return {
      target: decoder.decode(bytes.subarray(start, start + targetLength)),
      seed: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start + targetLength)),
    };
  } catch {
    return null;
  }
}

function isHttpUrl(target) {
  if (!/^https?:\/\//i.test(target)) return false;
  try {
    const url = new URL(target);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------- api */

/**
 * Build a link of exactly `totalLength` characters (protocol included) that
 * leads to `rawTarget`.
 *
 * The same `(target, length, seed)` always produces the same link. Omit the
 * seed and one is generated — it is carried inside the link, so the link can
 * always be rebuilt later.
 *
 * @returns {{url: string, target: string, seed: string, length: number,
 *            padding: number, minimum: number, warning: string|null}}
 * @throws {Error} with a `code` (`EMPTY_TARGET`, `INVALID_TARGET`, `BAD_SCHEME`,
 *   `SEED_TOO_LONG`, `INVALID_LENGTH`, `TOO_SHORT`, `TOO_LONG`) and `meta`
 *   numbers, so the UI can explain why the requested length cannot be reached.
 */
export function buildLink(rawTarget, totalLength, options = {}) {
  const target = normalizeTarget(rawTarget);
  const requested = Number(totalLength);
  if (!Number.isInteger(requested)) throw fail('INVALID_LENGTH', { requested: totalLength });

  const rand = options.randomInt || randomInt;
  const origin = options.origin || SITE_ORIGIN;
  const base = baseUrl(origin);
  const seed = normalizeSeed(options.seed, rand);
  const payload = encodePayload(target, seed);

  const minimum = base.length + LENGTH_PREFIX_CHARS + payload.length + MIN_PADDING;
  if (requested < minimum) throw fail('TOO_SHORT', { requested, minimum });
  if (requested > MAX_TOTAL_LENGTH) throw fail('TOO_LONG', { requested, maximum: MAX_TOTAL_LENGTH });

  // Deterministic from here on: header first, then the noise.
  const header = mixCase((payload.length + LENGTH_OFFSET).toString(36), seededRandom(target, seed, 'header'));
  if (header.length !== LENGTH_PREFIX_CHARS) {
    throw fail('TOO_LONG', { requested, maximum: MAX_TOTAL_LENGTH });
  }
  const padding = randomPadding(requested - minimum + MIN_PADDING, seededRandom(target, seed, 'padding'));
  const url = base + header + payload + padding;

  const check = parseLink(url);
  if (!check || check.target !== target || check.seed !== seed || !check.intact || url.length !== requested) {
    throw fail('INTERNAL', { requested });
  }

  return {
    url,
    target,
    seed,
    length: url.length,
    padding: padding.length,
    minimum,
    warning: requested > SOFT_MAX_LENGTH ? 'SOFT_TOO_LONG' : null,
  };
}

function mixCase(text, rand) {
  return text
    .split('')
    .map((char) => (/[a-z]/i.test(char) && rand(2) === 0 ? char.toUpperCase() : char.toLowerCase()))
    .join('');
}

/**
 * Read a generated link back. Accepts a full URL or a bare pathname and returns
 * `{target, seed, payload, padding, intact}`, or `null` when the path is not
 * one of our links.
 *
 * `intact` is false when the padding no longer matches what `(target, seed,
 * length)` says it should be — which is what a link that got edited, truncated
 * or mistyped looks like.
 */
export function parseLink(input) {
  const raw = String(input == null ? '' : input);
  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return null;
    }
  }
  const path = pathname.replace(/^\/+/, '');
  if (path.length <= LENGTH_PREFIX_CHARS) return null;

  const header = path.slice(0, LENGTH_PREFIX_CHARS).toLowerCase();
  if (!/^[0-9a-z]{3}$/.test(header)) return null;
  const payloadLength = parseInt(header, 36) - LENGTH_OFFSET;
  if (!Number.isInteger(payloadLength) || payloadLength <= 0) return null;

  const payload = path.slice(LENGTH_PREFIX_CHARS, LENGTH_PREFIX_CHARS + payloadLength);
  if (payload.length !== payloadLength) return null;

  const decoded = decodePayload(payload);
  if (!decoded || !isHttpUrl(decoded.target)) return null;

  const padding = path.slice(LENGTH_PREFIX_CHARS + payloadLength);
  const expected = randomPadding(padding.length, seededRandom(decoded.target, decoded.seed, 'padding'));

  return { ...decoded, payload, padding, intact: padding === expected };
}

/**
 * The recipe behind a link: feed these three values back into `buildLink()` and
 * you get the identical link back. Returns `null` for anything else.
 */
export function restoreLink(input, options = {}) {
  // `options.origin` only matters for reporting the total length.
  const parsed = parseLink(input);
  if (!parsed) return null;
  const path = parsed.payload.length + LENGTH_PREFIX_CHARS + parsed.padding.length;
  const origin = options.origin || SITE_ORIGIN;
  return {
    target: parsed.target,
    seed: parsed.seed,
    length: baseUrl(origin).length + path,
    intact: parsed.intact,
  };
}
