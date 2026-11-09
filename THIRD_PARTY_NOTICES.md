# Third-party notices

PicWay Tools is MIT-licensed (see [LICENSE](LICENSE)). The tools use the open-source libraries below. They are installed from npm by `npm ci` and are not copied into this repository, but a build (`npm run build`) bundles them into `dist/`. If you publish a build, keep these notices and the files in [`licenses/`](licenses/) with it.

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

libheif-js is loaded as its own JavaScript and WebAssembly file, only when a HEIC file needs it, and it is not modified here. Anyone can replace that file with another build of libheif-js. Its source code is at https://github.com/catdad-experiments/libheif-js, and the source of libheif and libde265 is at https://github.com/strukturag.

## Development tools

These are used only to build and test, and are not part of a build: [Vite](https://github.com/vitejs/vite) (MIT) and its dependencies, and [playwright-core](https://github.com/microsoft/playwright) (Apache-2.0).

## Test files

The sample files in `tests/fixtures/` are synthetic images and clips made for these tests. The landscape photo samples are derived from a photo by Ansgar Scheffold on [Unsplash](https://unsplash.com/photos/z_f2JrBRbOg) (Unsplash License), with made-up camera, date and GPS data.
