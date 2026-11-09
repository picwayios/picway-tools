// Links between tool pages. A tool can point the user to another tool (for example,
// "this is already a JPG, try Remove photo location"). Only tools that exist in this
// build get a link; for any other id, toolLink returns '' and the hint shows no link.
//
// The tool list comes from the build (vite.config.ts defines __PICWAY_TOOLS__ from the
// folders in tools/). Other hosts, such as a browser extension, call setToolLinks.
declare const __PICWAY_TOOLS__: readonly string[] | undefined;

let pages = new Set<string>(typeof __PICWAY_TOOLS__ === 'undefined' ? [] : __PICWAY_TOOLS__);
let hrefFor = (id: string) => `../${id}/`;

export function setToolLinks(ids: Iterable<string>, href: (id: string) => string) {
  pages = new Set(ids);
  hrefFor = href;
}

export const toolLink = (id: string) => (pages.has(id) ? hrefFor(id) : '');
