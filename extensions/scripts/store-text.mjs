// Writes store/<id>/listing.json and store/<id>/LISTING.md from store/listings.mjs and checks
// the store limits. Run after `npm run build` (it reads the built manifests).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GROUPS } from '../src/groups.mjs';
import { LISTINGS, description } from '../store/listings.mjs';

const problems = [];
const check = (ok, msg) => ok || problems.push(msg);

for (const g of GROUPS) {
  const l = LISTINGS[g.id];
  const m = JSON.parse(readFileSync(resolve('dist', g.id, 'manifest.json'), 'utf8'));
  const desc = description(g.id, g.name);
  const words = l.searchTerms.join(' ').split(/\s+/).length;
  check(g.name.length <= 45, `${g.id}: name ${g.name.length} > 45`);
  check(l.shortDescription.length <= 132, `${g.id}: short description ${l.shortDescription.length} > 132`);
  check(m.description === l.shortDescription, `${g.id}: manifest description differs from the listing (rebuild)`);
  check(desc.length >= 250 && desc.length <= 10000, `${g.id}: description ${desc.length} not in 250..10000 (Edge)`);
  check(l.searchTerms.length <= 7 && l.searchTerms.every((t) => t.length <= 30) && words <= 21, `${g.id}: search terms over the Edge limits`);
  check(!(m.permissions?.length || m.host_permissions?.length || m.optional_permissions?.length), `${g.id}: manifest asks for permissions`);

  const data = {
    name: g.name,
    shortDescription: l.shortDescription,
    description: desc,
    singlePurpose: l.singlePurpose,
    permissions: 'None requested (no "permissions", "host_permissions" or "optional_permissions" in the manifest).',
    remoteCode: l.remoteCode,
    dataUsage: l.dataUsage,
    privacyPolicy: l.privacyPolicy,
    website: l.website,
    support: l.support,
    publisher: l.publisher,
    language: l.language,
    chrome: { category: l.chromeCategory, storeIcon: 'icon-128.png', screenshots: '1280x800, screenshot-*.png', smallPromoTile: 'promo-440x280.png' },
    edge: { category: l.edgeCategory, logo: 'logo-300.png', screenshots: '1280x800, screenshot-*.png', smallPromoTile: 'promo-440x280.png', searchTerms: l.searchTerms },
    manifest: { version: m.version, permissions: [], content_security_policy: m.content_security_policy.extension_pages },
  };
  writeFileSync(join('store', g.id, 'listing.json'), JSON.stringify(data, null, 2) + '\n');

  const shots = ['1', '2', '3'].filter((n) => existsSync(join('store', g.id, `screenshot-${n}.png`))).map((n) => `screenshot-${n}.png`);
  const md = `# ${g.name}

## Both stores

| Field | Value |
|---|---|
| Name | ${g.name} |
| Short description | ${l.shortDescription} |
| Publisher | ${l.publisher} |
| Language | ${l.language} |
| Website | ${l.website} |
| Support | ${l.support} |
| Privacy policy | ${l.privacyPolicy} |
| Single purpose | ${l.singlePurpose} |
| Permissions | None |
| Remote code | ${l.remoteCode} |
| Data collected | ${l.dataUsage.collected} |
| Certifications | ${l.dataUsage.certify.join('; ')} |
| Screenshots | ${shots.join(', ')} |
| Small promotional tile | promo-440x280.png |

## Chrome Web Store

| Field | Value |
|---|---|
| Category | ${l.chromeCategory} |
| Store icon | icon-128.png |

## Microsoft Edge Add-ons

| Field | Value |
|---|---|
| Category | ${l.edgeCategory} |
| Extension logo | logo-300.png |
| Search terms | ${l.searchTerms.join(', ')} |
| Mature content | No |
| Notes for certification | The toolbar button opens the extension page in a new tab. ${l.testNote} No account or sign-in is needed. |

## Description

\`\`\`text
${desc}
\`\`\`
`;
  writeFileSync(join('store', g.id, 'LISTING.md'), md);
  console.log(g.id, `name ${g.name.length}, short ${l.shortDescription.length}, description ${desc.length}, search words ${words}`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
