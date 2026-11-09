// Loads the script for the tool on this page. Each page has one element with
// data-tool="<slug>"; only that tool's code is downloaded.
const loaders = import.meta.glob<{ mount: (el: HTMLElement) => void }>('../tools/*/main.ts');

const host = document.querySelector<HTMLElement>('[data-tool]');
if (host) {
  const load = loaders[`../tools/${host.dataset.tool}/main.ts`];
  if (load) {
    load()
      .then((m) => m.mount(host))
      .catch((e) => {
        console.error(e);
        host.textContent = host.dataset.loadFail ?? '';
      });
  }
}
