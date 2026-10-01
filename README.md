# Link Expander

**https://linkexpander.thebestmotherfuckingweb.site**

> Plenty of people try to make links shorter. So what if one is longer?

A deliberately silly, deliberately plain single page app: give it a link, a seed and a total length, and
it hands back a link on this domain whose total length — protocol included — is exactly the number you
asked for. Everything after the domain is meaningless noise, and opening the link goes to your
destination.

Nothing is stored anywhere: the destination **and** the seed travel inside the link, so the same
`target + seed + length` always rebuilds the identical link, and any link can be taken apart again later.

If the length you asked for cannot be reached — too short to even carry the destination and the seed, or
above the hard cap of 8192 characters — the page says so and reports the minimum that would work.

The page is bilingual (English / 中文): it follows `navigator.language`, has a toggle in the top right,
remembers your choice in `localStorage`, and re-renders everything — messages included — when you switch.

---

## How the link is built

```
https://linkexpander.thebestmotherfuckingweb.site/ I1B Kwsw3WtDoMwDl8HRq13VL-a7U1zQs_fKeSWG4YwNi-k OJKMcdzpHuVtIZQqZSNDCNl81CB11VWe
                                                   │   │                                        │
                                                   │   │                                        └── padding
                                                   │   └── payload: where to go + which seed
                                                   └── header: how long the payload is
```

| Part | Length | What it is |
| --- | --- | --- |
| `header` | 3 | `base36(payload length + 23328)`, letter case randomised, so it never reads like `00n` |
| `payload` | depends on the destination and seed | `base64url` of `"<target byte length>\n" + target + seed`, XOR-ed with a fixed keystream |
| `padding` | fills the rest, at least 8 | `[A-Za-z0-9]` noise derived from `(target, seed)`, always containing upper case, lower case and digits |

- **Minimum length** = base URL (50) + header (3) + payload + 8. For `https://example.com` with a five
  character seed that is **97**; a longer destination or seed pushes it up, and the page always reports
  the exact number it needs.
- **Maximum length** = 8192. Above 2000 the page still builds the link but warns that some browsers,
  chat apps and mail clients truncate long URLs.
- The XOR keystream (`lib.js`, `keystream()`) is **camouflage, not encryption**. It exists so the middle
  of a link does not look like an obvious `aHR0cHM6Ly9leGFtcGxl...` blob. Anyone with this repository can
  decode a link, and that is fine — the point is that it *looks* like noise.
- The noise is a **checksum for free**: `parseLink()` re-derives it from `(target, seed)`, so a link that
  was edited or truncated is reported with `intact: false` instead of silently pointing somewhere else.

## Seeds and restoring links

```js
import { buildLink, parseLink, restoreLink } from './lib.js';

// Same three inputs -> same link, today and next year, in any browser.
const a = buildLink('https://example.com', 200, { seed: 'my-seed' });
const b = buildLink('https://example.com', 200, { seed: 'my-seed' });
a.url === b.url; // true

// Recover everything from the link alone…
const recipe = restoreLink(a.url);
// {target: 'https://example.com', seed: 'my-seed', length: 200, intact: true}

// …and rebuild the identical link with it.
buildLink(recipe.target, recipe.length, { seed: recipe.seed }).url === a.url; // true

// Leave the seed out and one is generated (5 characters), still carried by the link.
parseLink(buildLink('https://example.com', 128).url).seed; // e.g. 'k7Qz2'
```

In the page the seed field is optional: leave it empty and a random one is generated and filled back in,
so pressing **Expand** twice reproduces the same link. Change the seed (or clear it) to get different
noise.

---

## Files

```
index.html                     the SPA shell, plus the static content and all the SEO tags
styles.css                     plain CSS, light and dark, no framework
app.js                         i18n (English / 中文), the form, the router, the redirect
lib.js                         the link format: build, parse, restore, seed noise — no DOM
og.png                         the 1200×630 social card
robots.txt, sitemap.xml        crawler hints, one canonical URL
tools/dev-server.mjs           local server with the GitHub Pages 404 fallback
tools/og-card.html             source of og.png
tests/link.test.mjs            node:test suite for the codec
CNAME                          custom domain (used only by branch-based publishing)
.github/workflows/deploy.yml   tests, then publishes to GitHub Pages
```

No build step, no dependencies, no backend, no analytics. `localStorage` keeps the chosen language and
the last input, nothing else.

## Local development

```sh
npm test          # codec tests, node:test, zero dependencies
npm start         # dev server with the 404 fallback -> http://localhost:8080
```

Deep links only work locally when unknown paths fall back to `index.html`, which is what
`tools/dev-server.mjs` does (and what GitHub Pages does with `404.html`).

You can pre-fill the form with query parameters, handy for testing and for sharing a preset:

```
http://localhost:8080/?target=example.com&seed=my-seed&length=240
```

## Deploying

1. Push this repository to GitHub with `main` as the default branch.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main` (or run the *Deploy to GitHub Pages* workflow manually). The workflow runs the tests,
   assembles `_site/`, and publishes it.
4. **Settings → Pages → Custom domain:** `linkexpander.thebestmotherfuckingweb.site`, then **Save**.
   With an Actions-based deployment no `CNAME` file is written to your branch, and the `CNAME` in this
   repository is ignored — the setting above is what counts.
5. At your DNS provider, add a `CNAME` record for the subdomain:

   | Type | Name | Value |
   | --- | --- | --- |
   | `CNAME` | `linkexpander` | `<your-username>.github.io` |

   If you move the site to an apex domain instead, use GitHub's `A` records
   (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`) and `AAAA` records
   (`2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`).
6. Once the DNS check passes, tick **Enforce HTTPS**.

### Why it survives deep links

A generated link like `/I1BKwsw3...` is not a file. GitHub Pages answers unknown paths with `404.html`,
which the workflow copies from `index.html`, so the SPA boots, reads `location.pathname`, decodes the
destination, and redirects. That is also why every asset is referenced relatively and generated links
never carry a trailing slash.

## Forking it somewhere else

1. `SITE_ORIGIN` in `lib.js` — the origin baked into generated links.
2. `CNAME` and the custom domain in the README and in Step 4 above.
3. Nothing else; the workflow has no domain hardcoded.

If you add a file to the site, add it to the `cp` list in `.github/workflows/deploy.yml`.

---

## SEO

The site is a client-rendered SPA, so the rules are a bit different from a normal page:

- **The real content is in the static HTML.** `index.html` ships the `h1`, the tagline, the "how does it
  work" copy, the limits paragraph and the credit as plain markup — not as JavaScript strings a crawler
  would have to execute. The app overwrites that markup with the localized text once it boots.
- **The generator page is visible without JavaScript.** `#view-generator` is not `hidden` in the markup;
  a three-line script in `<head>` adds a `.deep-link` class when the path is a generated link, so the
  form is hidden instantly on those instead of flashing before the redirect.
- **Generated links are never indexable.** They are random, infinite in number, and answered by GitHub
  Pages with a 404 status plus the app. On top of that, the app switches `meta[name=robots]` to
  `noindex, nofollow` and drops the canonical link whenever it renders the redirect view. Crawling one
  shared link will not spawn an index of noise URLs.
- **One canonical URL.** `rel=canonical` points at the root. `?lang=en|zh` is a client-side preference
  (shareable, overrides `navigator.language`), not a separate document, so there is no `hreflang` set —
  pointing alternates at URLs that serve byte-identical HTML would be a duplicate-content signal rather
  than a win. `inLanguage` in the JSON-LD covers both languages instead.
- `robots.txt` allows everything and points at `sitemap.xml`, which lists the single canonical URL and
  deliberately not the generated ones.
- Social cards: Open Graph and Twitter tags plus a real 1200×630 `og.png`. The card's source is
  `tools/og-card.html`; regenerate with
  `npx playwright@latest screenshot --viewport-size=1200,630 tools/og-card.html og.png`.
- `WebApplication` JSON-LD (free, requires JavaScript, English and Simplified Chinese).

Still to do by hand, once: submit the site in Google Search Console / Bing Webmaster Tools and paste the
verification meta tag into `index.html`.

## Limits and honesty

- Redirects are client side: without JavaScript a generated link is dead.
- Very long links (2000+) are not reliable outside a browser address bar — the page warns you.
- The destination must be `http` or `https`. Other schemes are refused, in the generator and in the
  decoder.
- Anyone can decode a generated link, seed included. The seed is a reproducibility knob, not a secret:
  do not treat a link as encrypted, and do not reuse a password as a seed.
- Style (and the attitude) borrowed from [thebestmotherfuckingweb.site](https://thebestmotherfuckingweb.site).

## License

MIT — see [LICENSE](LICENSE).
