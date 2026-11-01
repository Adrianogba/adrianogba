// Generates assets/stats-dark.svg and assets/stats-light.svg.
//
// Needs a token that can read private repositories, because most of my work
// happens there. Only totals reach the SVG. Repository names are never written
// to it or to the log, since Actions logs are public on this repository.
//
//   GITHUB_TOKEN=$(gh auth token) node scripts/generate-stats.mjs

import { writeFile } from 'node:fs/promises';

const LOGIN = 'Adrianogba';

// Compiled output, not code I wrote by hand.
const IGNORED_REPOS = new Set(['adrianogba.github.io']);

// Scaffolding that Flutter and Xcode generate, plus markup.
const IGNORED_LANGUAGES = new Set([
  'Batchfile', 'C', 'C++', 'CMake', 'CSS', 'Dockerfile', 'HTML',
  'Makefile', 'Objective-C', 'PowerShell', 'Ruby', 'SCSS', 'Shell',
]);

const TOP_LANGUAGES = 6;

const QUERY = `
  query ($login: String!, $after: String) {
    user(login: $login) {
      contributionsCollection { contributionCalendar { totalContributions } }
      repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
    }
  }`;

async function graphql(token, variables) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'user-agent': LOGIN },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  const { data, errors } = await response.json();
  if (errors) throw new Error(errors.map((e) => e.message).join('; '));
  return data.user;
}

async function collect(token) {
  const repositories = [];
  let contributions = 0;
  let after = null;
  do {
    const user = await graphql(token, { login: LOGIN, after });
    contributions = user.contributionsCollection.contributionCalendar.totalContributions;
    repositories.push(...user.repositories.nodes);
    after = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
  } while (after);

  const sizes = new Map();
  for (const repository of repositories) {
    if (IGNORED_REPOS.has(repository.name)) continue;
    for (const { size, node } of repository.languages.edges) {
      if (IGNORED_LANGUAGES.has(node.name)) continue;
      const entry = sizes.get(node.name) ?? { name: node.name, color: node.color, size: 0 };
      entry.size += size;
      sizes.set(node.name, entry);
    }
  }

  const total = [...sizes.values()].reduce((sum, { size }) => sum + size, 0);
  const languages = [...sizes.values()]
    .sort((a, b) => b.size - a.size)
    .slice(0, TOP_LANGUAGES)
    .map((language) => ({ ...language, share: language.size / total }));

  return { contributions, languages };
}

const THEMES = {
  dark: { text: '#e6edf3', muted: '#8b949e', border: '#30363d', track: '#21262d' },
  light: { text: '#1f2328', muted: '#59636e', border: '#d1d9e0', track: '#eff2f5' },
};

function render({ contributions, languages }, theme) {
  const width = 830;
  const height = 196;
  const pad = 24;
  const barWidth = width - pad * 2;
  const shareLabel = (share) => `${Math.max(1, Math.round(share * 100))}%`;

  const covered = languages.reduce((sum, { share }) => sum + share, 0);
  let x = pad;
  const bar = languages
    .map(({ color, share }) => {
      const w = (share / covered) * barWidth;
      const rect = `<rect x="${x.toFixed(1)}" y="96" width="${Math.max(w - 2, 1).toFixed(1)}" height="10" fill="${color}"/>`;
      x += w;
      return rect;
    })
    .join('');

  const legend = languages
    .map(({ name, color, share }, i) => {
      const lx = pad + (i % 6) * (barWidth / 6);
      return `<circle cx="${(lx + 5).toFixed(1)}" cy="130" r="5" fill="${color}"/>`
        + `<text x="${(lx + 16).toFixed(1)}" y="135" font-size="14" fill="${theme.text}">${name}`
        + ` <tspan fill="${theme.muted}">${shareLabel(share)}</tspan></text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${contributions} contributions in the last year. Top languages: ${languages.map((l) => l.name).join(', ')}.">
  <style>
    .bar { transform-origin: ${pad}px 0; animation: grow 1.2s cubic-bezier(.2, .7, .2, 1) both; }
    @keyframes grow { from { transform: scaleX(0); } }
    @media (prefers-reduced-motion: reduce) { .bar { animation: none; } }
  </style>
  <defs><clipPath id="round"><rect x="${pad}" y="96" width="${barWidth}" height="10" rx="5"/></clipPath></defs>
  <rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="10" fill="none" stroke="${theme.border}"/>
  <g font-family="-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,Helvetica,Arial,sans-serif">
    <text x="${pad}" y="58" font-size="34" font-weight="600" fill="${theme.text}">${contributions.toLocaleString('en-US')}</text>
    <text x="${pad}" y="78" font-size="14" fill="${theme.muted}">contributions in the last 12 months</text>
    <rect x="${pad}" y="96" width="${barWidth}" height="10" rx="5" fill="${theme.track}"/>
    <g clip-path="url(#round)"><g class="bar">${bar}</g></g>
    ${legend}
    <text x="${pad}" y="172" font-size="12" fill="${theme.muted}">Includes private work. Share of code by size, leaving out generated builds and platform scaffolding.</text>
  </g>
</svg>
`;
}

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN is required');

const stats = await collect(token);

for (const [name, theme] of Object.entries(THEMES)) {
  await writeFile(new URL(`../assets/stats-${name}.svg`, import.meta.url), render(stats, theme));
}

console.log(`${stats.contributions} contributions`);
