# Test files

Synthetic samples for the unit and browser tests:

- `convert/`: small generated images (gradients, transparent shapes, color blocks) in PNG, WebP, AVIF, BMP, TIFF and GIF, plus deliberately broken files.
- `photo/`: JPEG and HEIC samples with made-up camera, date and GPS data. The landscape samples are derived from a photo by Ansgar Scheffold on [Unsplash](https://unsplash.com/photos/z_f2JrBRbOg) (Unsplash License); the others are color blocks. `photo/qa/` holds more GPS and XMP cases.
- `video/`: short generated clips (H.264, HEVC, ProRes; MOV and MP4; rotated and flipped) and generated GIFs with different frame timings and transparency.
- `full-range-512.heic`, `live-photo-tracks.json`: HEIC color range and Live Photo track layout cases.

The GPS values in these files are made up for testing, and none of the files contains personal content.
