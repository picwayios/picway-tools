# Third-party notices

PicWay Tools is MIT-licensed (see [LICENSE](LICENSE)). The tools use the open-source libraries below. They are installed from npm by `npm ci` and are not copied into this repository, but a build (`npm run build`) bundles them into `dist/` (libheif-js is copied unchanged instead; see below). If you publish a build, keep these notices and the files in [`licenses/`](licenses/) with it.

| Package | Version | License | Used for | License text |
|---|---|---|---|---|
| [@jsquash/avif](https://github.com/jamsinclair/jSquash) | 2.1.1 | Apache-2.0 | AVIF encode and decode (WebAssembly) | [licenses/jsquash-avif.txt](licenses/jsquash-avif.txt) |
| ↳ [libavif](https://github.com/AOMediaCodec/libavif) v1.0.1, built into the AVIF codec | | BSD-2-Clause (with notices for bundled code) | | [licenses/libavif.txt](licenses/libavif.txt) |
| ↳ [libaom](https://aomedia.googlesource.com/aom/) v3.7.0, built into the AVIF codec | | BSD-2-Clause, plus the Alliance for Open Media Patent License 1.0 | | [licenses/libaom.txt](licenses/libaom.txt), [licenses/libaom-PATENTS.txt](licenses/libaom-PATENTS.txt) |
| [@jsquash/webp](https://github.com/jamsinclair/jSquash) | 1.5.0 | Apache-2.0 | WebP encode (WebAssembly) | [licenses/jsquash-webp.txt](licenses/jsquash-webp.txt) |
| ↳ [libwebp](https://chromium.googlesource.com/webm/libwebp), built into the WebP codec | | BSD-3-Clause | | [licenses/libwebp.txt](licenses/libwebp.txt) |
| [wasm-feature-detect](https://github.com/GoogleChromeLabs/wasm-feature-detect) (dependency of @jsquash) | 1.9.0 | Apache-2.0 | picks the WebAssembly build the browser supports | [licenses/wasm-feature-detect.txt](licenses/wasm-feature-detect.txt) |
| [libheif-js](https://github.com/catdad-experiments/libheif-js) | 1.23.5 | LGPL-3.0 | HEIC decode in browsers that can’t open HEIC themselves | [licenses/libheif-js-LGPL-3.0.txt](licenses/libheif-js-LGPL-3.0.txt) |
| ↳ [libheif](https://github.com/strukturag/libheif) and the [libde265](https://github.com/strukturag/libde265) HEVC decoder, built into libheif-js | | LGPL-3.0 | | [licenses/libheif.txt](licenses/libheif.txt) (includes the GPL-3.0 text that LGPL-3.0 refers to) |
| [exifr](https://github.com/MikeKovarik/exifr) | 7.1.3 | MIT | reading EXIF, GPS and XMP | [licenses/exifr.txt](licenses/exifr.txt) |
| [piexifjs](https://github.com/hMatoba/piexifjs) | 1.0.6 | MIT | writing EXIF into JPEG | [licenses/piexifjs.txt](licenses/piexifjs.txt) |
| [gifenc](https://github.com/mattdesl/gifenc) | 1.0.3 | MIT | GIF encode and color palettes | [licenses/gifenc.txt](licenses/gifenc.txt) |
| [UPNG.js](https://github.com/photopea/UPNG.js) (upng-js) | 2.1.0 | MIT | PNG encode with reduced colors | [licenses/upng-js.txt](licenses/upng-js.txt) |
| [UTIF.js](https://github.com/photopea/UTIF.js) (utif) | 3.1.0 | MIT | TIFF decode and encode | [licenses/utif.txt](licenses/utif.txt) |
| [pako](https://github.com/nodeca/pako) (dependency of upng-js and utif) | 1.0.11 | MIT and Zlib | deflate and inflate | [licenses/pako.txt](licenses/pako.txt) |
| [mp4box.js](https://github.com/gpac/mp4box.js) (mp4box) | 2.5.0 | BSD-3-Clause | reading MP4 and MOV files | [licenses/mp4box.txt](licenses/mp4box.txt) |
| [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) | 5.2.2 | MIT | writing MP4 files | [licenses/mp4-muxer.txt](licenses/mp4-muxer.txt) |

## About the LGPL-3.0 part

**What is used.** libheif-js 1.23.5 from npm, file `libheif-wasm/libheif-bundle.mjs` (2,043,959 bytes, SHA-256 `095194187be00d3e36335b8ad7f5552d70655e5e2159486d7d36cd4daa47bba9`). It is one ES module with the WebAssembly binary embedded. It contains libheif 1.23.5 (the library reports this version) and the libde265 1.0.15 HEVC decoder. No other codec is compiled into it.

**Not modified.** This repository does not change libheif-js, libheif or libde265. `npm run build` does not bundle or minify the file either: it copies it byte for byte to `dist/libheif/libheif-bundle.mjs`, and the HEIC decoder loads it from there with a dynamic `import()` only when a file needs it. You can check this with `cmp dist/libheif/libheif-bundle.mjs node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs`.

**Replacing it.** To use a modified or newer build, put an interface-compatible libheif-js ES module at `dist/libheif/libheif-bundle.mjs` in place of the original (or install another libheif-js version and run `npm run build`). Nothing else needs to change. The code that calls it is [`packages/core/src/heic.ts`](packages/core/src/heic.ts).

**Source code.**
- libheif-js 1.23.5: https://github.com/catdad-experiments/libheif-js (tag `1.23.5`). Its install script downloads the build from https://github.com/catdad-experiments/libheif-emscripten (release `v1.23.5`), which compiles libheif with libheif’s own `build-emscripten.sh` and no changes to source or build scripts.
- libheif 1.23.5: https://github.com/strukturag/libheif (tag `v1.23.5`, commit `413e2a87e6a70b3eccc3a3adc5801179dd2d9e00`).
- libde265 1.0.15: https://github.com/strukturag/libde265 (release `v1.0.15`).

**License texts.** [licenses/libheif-js-LGPL-3.0.txt](licenses/libheif-js-LGPL-3.0.txt) is the LGPL-3.0 text from the libheif-js package. [licenses/libheif.txt](licenses/libheif.txt) is the license file shipped with its WebAssembly build (LGPL-3.0 followed by GPL-3.0). [licenses/GPL-3.0.txt](licenses/GPL-3.0.txt) is the GPL-3.0 text on its own, because LGPL-3.0 refers to it.

## Development tools

[Vite](https://github.com/vitejs/vite) (MIT) builds the tools; the only Vite code in a build is its small module-preload helper. [playwright-core](https://github.com/microsoft/playwright) (Apache-2.0) is used only for the browser tests and is not part of a build.

## Test files

The sample files in `tests/fixtures/` are synthetic images and clips made for these tests. The landscape photo samples are derived from a photo by Ansgar Scheffold on [Unsplash](https://unsplash.com/photos/z_f2JrBRbOg) (Unsplash License), with made-up camera, date and GPS data.
