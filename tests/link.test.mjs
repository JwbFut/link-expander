import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LENGTH,
  DEFAULT_SEED_LENGTH,
  LENGTH_PREFIX_CHARS,
  MAX_SEED_LENGTH,
  MAX_TOTAL_LENGTH,
  MIN_PADDING,
  SITE_ORIGIN,
  baseUrl,
  buildLink,
  decodePayload,
  encodePayload,
  normalizeTarget,
  parseLink,
  randomPadding,
  randomSeed,
  restoreLink,
} from '../lib.js';

const BASE = baseUrl(SITE_ORIGIN);
const TARGET = 'https://example.com';
const SEED = 'k7Qz2';

const minFor = (target, seed) => {
  try {
    buildLink(target, 1, { seed });
  } catch (error) {
    return error.meta.minimum;
  }
  throw new Error('expected TOO_SHORT');
};

/* ---------------------------------------------------------------- targets */

test('normalizeTarget adds a scheme, trims, and rejects junk', () => {
  assert.equal(normalizeTarget('example.com'), 'https://example.com');
  assert.equal(normalizeTarget('  https://a.b/c?d=1  '), 'https://a.b/c?d=1');
  assert.equal(normalizeTarget('http://a.b'), 'http://a.b');
  assert.throws(() => normalizeTarget(''), (error) => error.code === 'EMPTY_TARGET');
  assert.throws(() => normalizeTarget('   '), (error) => error.code === 'EMPTY_TARGET');
  assert.throws(() => normalizeTarget('javascript:alert(1)'), (error) => error.code === 'BAD_SCHEME');
  assert.throws(() => normalizeTarget('ftp://example.com/x'), (error) => error.code === 'BAD_SCHEME');
  assert.throws(() => normalizeTarget('data:text/html,hi'), (error) => error.code === 'BAD_SCHEME');
});

/* ---------------------------------------------------------------- payload */

test('target and seed survive the payload round trip, non-ASCII included', () => {
  const cases = [
    [TARGET, SEED],
    ['https://example.com/搜索?q=中文&x=1', '种子'],
    [`https://example.com/?q=${'x'.repeat(300)}`, 'a'.repeat(MAX_SEED_LENGTH)],
    ['https://example.com/#😀', 'seed with spaces'],
  ];
  for (const [target, seed] of cases) {
    assert.deepEqual(decodePayload(encodePayload(target, seed)), { target, seed });
  }
});

test('the payload is path safe and camouflaged, not recognisable base64', () => {
  const encoded = encodePayload(TARGET, SEED);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.equal(/aHR0cHM6/i.test(encoded), false);
  assert.equal(encoded.toLowerCase().includes('http'), false);
  assert.equal(encoded.includes(SEED), false);
});

test('decodePayload rejects garbage instead of throwing', () => {
  assert.equal(decodePayload(''), null);
  assert.equal(decodePayload('!!!!'), null);
  assert.equal(decodePayload('a b'), null);
  assert.equal(decodePayload(undefined), null);
  assert.equal(decodePayload('AAAA'), null);
});

/* ----------------------------------------------------------- seeds & noise */

test('randomSeed hands out the requested number of alphanumeric characters', () => {
  for (let i = 0; i < 10; i++) {
    const seed = randomSeed();
    assert.equal(seed.length, DEFAULT_SEED_LENGTH);
    assert.match(seed, /^[A-Za-z0-9]+$/);
  }
  assert.equal(randomSeed(12).length, 12);
});

test('the padding always mixes upper case, lower case and digits', () => {
  for (let i = 0; i < 25; i++) {
    const padding = randomPadding(12);
    assert.match(padding, /^[A-Za-z0-9]+$/);
    assert.match(padding, /[A-Z]/);
    assert.match(padding, /[a-z]/);
    assert.match(padding, /[0-9]/);
  }
  assert.equal(randomPadding(0), '');
});

/* ------------------------------------------------------------- generation */

test('generated links have exactly the requested length and decode back', () => {
  for (const total of [DEFAULT_LENGTH, 137, 512, 2000]) {
    const result = buildLink(TARGET, total, { seed: SEED });
    assert.equal(result.url.length, total, `length ${total}`);
    assert.ok(result.url.startsWith(BASE));
    assert.equal(result.warning, total > 2000 ? 'SOFT_TOO_LONG' : null);

    const parsed = parseLink(result.url);
    assert.ok(parsed, `parse ${total}`);
    assert.equal(parsed.target, TARGET);
    assert.equal(parsed.seed, SEED);
    assert.equal(parsed.padding.length, result.padding);
    assert.equal(parsed.intact, true);
  }
});

test('the protocol header is part of the counted length', () => {
  const result = buildLink(TARGET, 128, { seed: SEED });
  assert.ok(result.url.startsWith('https://'), result.url);
  assert.equal(result.url.length, 128);
});

/* -------------------------------------------------------- reproducibility */

test('same target, length and seed always rebuild the very same link', () => {
  const first = buildLink(TARGET, 200, { seed: 'hello seed' });
  const second = buildLink(TARGET, 200, { seed: 'hello seed' });
  assert.equal(first.url, second.url);
  assert.equal(first.seed, 'hello seed');
});

test('a link can be restored from nothing but the link itself', () => {
  const { url } = buildLink('https://example.com/some/page?q=1', 300);
  const recipe = restoreLink(url);
  assert.ok(recipe);
  assert.equal(recipe.target, 'https://example.com/some/page?q=1');
  assert.equal(recipe.intact, true);
  assert.equal(recipe.length, 300);
  // Feed the recipe back in: byte for byte the same link.
  assert.equal(buildLink(recipe.target, recipe.length, { seed: recipe.seed }).url, url);
});

test('a different seed gives a different link, noise and all', () => {
  const a = buildLink(TARGET, 200, { seed: 'seed-a' });
  const b = buildLink(TARGET, 200, { seed: 'seed-b' });
  assert.notEqual(a.url, b.url);
  assert.notEqual(a.url.slice(BASE.length), b.url.slice(BASE.length));
});

test('the same seed with a different target does not repeat the noise', () => {
  const a = buildLink('https://a.example', 200, { seed: 'same' });
  const b = buildLink('https://b.example', 200, { seed: 'same' });
  assert.notEqual(parseLink(a.url).padding, parseLink(b.url).padding);
});

test('an empty seed is replaced by a fresh random one, and reused afterwards', () => {
  const first = buildLink(TARGET, 128);
  const second = buildLink(TARGET, 128);
  assert.equal(first.seed.length, DEFAULT_SEED_LENGTH);
  assert.notEqual(first.seed, second.seed);
  assert.notEqual(first.url, second.url);
  assert.equal(buildLink(TARGET, 128, { seed: first.seed }).url, first.url);
  assert.equal(parseLink(first.url).seed, first.seed);
});

test('the header hides the payload length behind an offset and random case', () => {
  const { url } = buildLink(TARGET, 200, { seed: SEED });
  const header = url.slice(BASE.length, BASE.length + LENGTH_PREFIX_CHARS);
  assert.match(header, /^[0-9A-Za-z]{3}$/);
  const payloadLength = encodePayload(TARGET, SEED).length;
  const naive = payloadLength.toString(36).padStart(LENGTH_PREFIX_CHARS, '0');
  assert.notEqual(header.toLowerCase(), naive);

  const variants = new Set();
  for (let i = 0; i < 40; i++) {
    variants.add(buildLink(TARGET, 200).url.slice(BASE.length, BASE.length + LENGTH_PREFIX_CHARS));
  }
  assert.ok(variants.size > 1, 'header case is part of the noise');
});

test('the tail looks like noise, not like the destination', () => {
  const { url } = buildLink('https://secret.example.com/private-page', 200, { seed: 'plain' });
  const tail = url.slice(BASE.length);
  assert.equal(/secret|private|example/i.test(tail), false);
  assert.ok(tail.length >= LENGTH_PREFIX_CHARS + MIN_PADDING);
});

/* --------------------------------------------------------------- integrity */

test('an edited link is still readable, but reported as not intact', () => {
  const { url } = buildLink(TARGET, 200, { seed: SEED });
  const tampered = url.slice(0, -1) + (url.endsWith('A') ? 'B' : 'A');
  const parsed = parseLink(tampered);
  assert.ok(parsed, 'the destination is still there');
  assert.equal(parsed.target, TARGET);
  assert.equal(parsed.intact, false);
});

test('a link with extra junk appended is readable and flagged', () => {
  const { url } = buildLink(TARGET, 200, { seed: SEED });
  assert.equal(parseLink(`${url}extra`).intact, false);
  assert.equal(parseLink(`${url}/`).intact, false);
});

test('parseLink only accepts our links', () => {
  assert.equal(parseLink('/'), null);
  assert.equal(parseLink('/index.html'), null);
  assert.equal(parseLink('/about'), null);
  assert.equal(parseLink('/1234567890'), null);
  assert.equal(parseLink(''), null);
  assert.equal(parseLink('https://elsewhere.example/abcdefghij'), null);
  assert.equal(restoreLink('/about'), null);
});

/* ------------------------------------------------------------------ limits */

test('the minimum length is honest: it is reported and exactly achievable', () => {
  let error;
  try {
    buildLink(TARGET, 10, { seed: SEED });
  } catch (caught) {
    error = caught;
  }
  assert.equal(error.code, 'TOO_SHORT');
  assert.equal(error.meta.requested, 10);
  assert.ok(error.meta.minimum > 10);
  assert.equal(buildLink(TARGET, error.meta.minimum, { seed: SEED }).url.length, error.meta.minimum);
});

test('the default length reaches the default seed for short destinations', () => {
  const { url, seed } = buildLink(TARGET, DEFAULT_LENGTH);
  assert.equal(url.length, DEFAULT_LENGTH);
  assert.equal(seed.length, DEFAULT_SEED_LENGTH);
});

test('a longer destination or seed raises the minimum, and short requests are refused', () => {
  const longTarget = `https://example.com/${'y'.repeat(400)}`;
  assert.ok(minFor(longTarget, SEED) > minFor(TARGET, SEED));
  assert.ok(minFor(TARGET, 'x'.repeat(MAX_SEED_LENGTH)) > minFor(TARGET, SEED));
  assert.throws(() => buildLink(longTarget, 100, { seed: SEED }), (error) => error.code === 'TOO_SHORT');
});

test('oversized seeds, oversized lengths and non-integers are refused', () => {
  assert.throws(
    () => buildLink(TARGET, 200, { seed: 'x'.repeat(MAX_SEED_LENGTH + 1) }),
    (error) => error.code === 'SEED_TOO_LONG' && error.meta.maximum === MAX_SEED_LENGTH
  );
  assert.throws(
    () => buildLink(TARGET, MAX_TOTAL_LENGTH + 1, { seed: SEED }),
    (error) => error.code === 'TOO_LONG' && error.meta.maximum === MAX_TOTAL_LENGTH
  );
  assert.throws(() => buildLink(TARGET, 100.5, { seed: SEED }), (error) => error.code === 'INVALID_LENGTH');
  assert.throws(() => buildLink(TARGET, 'lots', { seed: SEED }), (error) => error.code === 'INVALID_LENGTH');
});

test('every character of a generated link is ASCII, so no percent-encoding is needed', () => {
  const { url } = buildLink('https://example.com/搜索', 300, { seed: '种子' });
  assert.equal(encodeURI(url), url);
});
