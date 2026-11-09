// Builds the tool list on the start page from the tool pages themselves,
// so a new folder in tools/ shows up here without editing this file.
const pages = import.meta.glob<string>('../tools/*/index.html', { query: '?raw', import: 'default', eager: true });

const list = document.getElementById('tools');
const doc = new DOMParser();
for (const [path, html] of Object.entries(pages).sort(([a], [b]) => a.localeCompare(b))) {
  const slug = path.split('/')[2];
  const page = doc.parseFromString(html, 'text/html');
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = `./tools/${slug}/`;
  a.textContent = page.querySelector('h1')?.textContent ?? slug;
  const span = document.createElement('span');
  span.textContent = page.querySelector('.lede')?.textContent ?? '';
  li.append(a, span);
  list?.append(li);
}
