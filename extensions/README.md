# PicWay browser extensions

Four extensions for Chrome and Microsoft Edge that put the [PicWay web tools](https://picway.app/tools/) in a browser tab. Your files are processed inside your browser, and the extensions have no server that receives them. They ask for no browser permissions.

| Extension | What it does | Tools |
|---|---|---|
| PicWay Image & Video Compressor | Make image and video files smaller. | Compress images, Compress video |
| PicWay Image & Video Converter | Change image and video files from one format to another. | HEIC to JPG, Image converter, MOV to MP4, Video to GIF, GIF to MP4 |
| PicWay Photo Location & Metadata | View, change or remove the location and other metadata stored in photos. | Remove photo location, Edit photo metadata |
| PicWay Photo Editor | Crop, resize, blur or pixelate, add a border or combine photos into a collage. | Crop image, Resize images, Blur image, Photo border, Photo collage |

Click an extension's toolbar button to open its tools page in a new tab, or to switch to that tab if it is already open. On the page, each tool has its own tab. Each tool does the same job as its page on picway.app. One difference: in the extension, Edit photo metadata has no map or place search, so you type or paste the coordinates. Links to picway.app open in a new tab only when you click them.

## How it is built

- Manifest V3. No `permissions`, `host_permissions` or content scripts. The extension page policy allows `'wasm-unsafe-eval'`, which the image codecs (WebAssembly) need, and limits network access from the page to the extension itself.
- All code and WebAssembly files are in the package. Nothing is loaded from the network.
- When a video tool decodes or re-encodes video, it uses the browser's WebCodecs.

## Build

From the root of this repository, after `npm ci`:

```sh
npm run build:extensions   # extensions/dist/<id>/ and extensions/dist/<id>.zip
```

The extensions use the tools in `tools/` and the processing code in `packages/core`. Card names and steps are in `src/tool-data.json`; store text is in `store/listings.mjs` (`npm run store` in this folder writes `store/<id>/LISTING.md`). The same source gives the same zip. To try a build, open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, choose **Load unpacked** and pick `extensions/dist/<id>`.

## Test

```sh
npm run test:extensions                                   # Playwright's Chromium (image tools)
node extensions/test/e2e.mjs --browser <path to a Chromium build with H.264> --compare
node extensions/test/negctl.mjs                           # network check negative control
```

The test runs every tool on the files in `tests/fixtures/`, saves the downloads, records every request the extension pages make, and with `--compare` runs the same steps on picway.app and compares the outputs. Playwright's own Chromium has no H.264 or AAC decoder, so the video tools are skipped there.

## About PicWay

PicWay is an iPhone app for sorting your photos. Swipe left or right to decide which photos to keep. Private Vault is a separate place for the photos, videos and files you want to keep apart: you open it by drawing a pattern, and you reach it by long-pressing the search button in the tab bar. PicWay also edits videos (cut out a section in the middle, or change the speed of parts of a clip), adds custom filters, converts formats, cleans up similar and duplicate photos, and searches your library. You'll also find memories from this day in past years, collages, compression, and Life Photos Only, which puts screenshots, screen recordings and animated images aside. PicWay browses, analyzes, compresses, organizes, and deletes your photos and videos on your iPhone. PicWay has no server that receives your photos. Your photos and videos leave this phone in only one case: the Private Vault’s iCloud sync (on by default). Items are encrypted and stored in your own iCloud, and only you can open them. PicWay isn't on the App Store yet. Learn more at [picway.app](https://picway.app/).

## License

PicWay’s own code is MIT-licensed (`LICENSE` at the root of this repository). The libraries each extension bundles keep their own licenses. libheif-js (LGPL-3.0) is shipped unmodified as its own file, `libheif/libheif-bundle.mjs`; see “In the browser extensions” in `THIRD_PARTY_NOTICES.md`. Each extension package includes `third-party-notices.txt`, made from `THIRD_PARTY_NOTICES.md` and the `licenses/` folder at the root of this repository, for the libraries that extension bundles.
