// Store listing text for the four extensions (English). scripts/store-text.mjs checks the
// limits and writes store/<id>/listing.json and store/<id>/LISTING.md from this file.

const SITE = 'https://picway.app';

const LOCAL = 'Your files are processed inside your browser, and this extension has no server that receives them. The extension asks for no browser permissions.';

const HOW = (first) => `How to use
1. Click the extension's button in the toolbar. A tab opens with the tools.
2. Pick ${first}, choose your files, and change the settings if you like.
3. Download the result.`;

export const ABOUT = `About PicWay
PicWay is an iPhone app for sorting your photos. Swipe left or right to decide which photos to keep. Private Vault is a separate place for the photos, videos and files you want to keep apart: you open it by drawing a pattern, and you reach it by long-pressing the search button in the tab bar. PicWay also edits videos (cut out a section in the middle, or change the speed of parts of a clip), adds custom filters, converts formats, cleans up similar and duplicate photos, and searches your library. You'll also find memories from this day in past years, collages, compression, and Life Photos Only, which puts screenshots, screen recordings and animated images aside. PicWay browses, analyzes, compresses, organizes, and deletes your photos and videos on your iPhone. PicWay has no server that receives your photos. Your photos and videos leave this phone in only one case: the Private Vault’s iCloud sync (on by default). Items are encrypted and stored in your own iCloud, and only you can open them. PicWay isn't on the App Store yet. Learn more at ${SITE}/`;

const common = {
  publisher: 'PicWay',
  website: `${SITE}/tools/`,
  support: `${SITE}/support/`,
  privacyPolicy: `${SITE}/privacy/`,
  language: 'English',
  permissions: [],
  remoteCode: 'No, I am not using remote code. All code and WebAssembly files are inside the package.',
  dataUsage: {
    collected: 'None. Your files are processed inside your browser, and this extension has no server that receives them.',
    certify: [
      'I do not sell or transfer user data to third parties, outside of the approved use cases',
      'I do not use or transfer user data for purposes that are unrelated to my item\'s single purpose',
      'I do not use or transfer user data to determine creditworthiness or for lending purposes',
    ],
  },
};

export const LISTINGS = {
  compress: {
    ...common,
    shortDescription: 'Compress images and videos in your browser. JPG, PNG, WebP, HEIC and more, plus MOV and MP4 videos from your iPhone or camera.',
    singlePurpose: 'Make image and video files smaller. The extension opens a page with two tools: compress images and compress a video. Your files are processed inside your browser, and this extension has no server that receives them.',
    chromeCategory: 'Tools',
    edgeCategory: 'Photos',
    searchTerms: ['compress image', 'compress video', 'image compressor', 'reduce photo size', 'heic', 'jpg', 'mp4'],
    tools: [
      ['Compress images', `Make images smaller, by quality or a target size. Works with JPG, PNG, WebP, HEIC, AVIF, BMP and TIFF, up to 50 files in the list. Set a quality, or type a target file size such as 500 KB. You can also cap the longest side, save as JPG or WebP, and remove the location (GPS) or all camera and date info. Each row shows the old and new size, and you can download each file or all of them in one ZIP.`, `${SITE}/tools/compress-image/`],
      ['Compress video', `Make a video smaller to send or share. Choose a MOV or MP4 from your iPhone or camera, pick Balanced (smaller, still sharp) or Smallest (for sending over chat or email), and keep the original size or limit it to 1080p or 720p. The page shows the size before and after.`, `${SITE}/tools/compress-video/`],
    ],
    first: 'Compress images or Compress video',
    testNote: 'In Compress images, choose a JPG or PNG photo. In Compress video, choose an MP4 or MOV video and click Compress.',
  },
  convert: {
    ...common,
    shortDescription: 'Convert images and videos in your browser: HEIC to JPG, PNG to JPG, WebP and more, MOV to MP4, video to GIF and GIF to MP4.',
    singlePurpose: 'Change image and video files from one format to another. The extension opens a page with five converters (HEIC to JPG, image formats, MOV to MP4, video to GIF, GIF to MP4). Your files are processed inside your browser, and this extension has no server that receives them.',
    chromeCategory: 'Tools',
    edgeCategory: 'Photos',
    searchTerms: ['heic to jpg', 'mov to mp4', 'video to gif', 'gif to mp4', 'image converter', 'webp to jpg', 'png to jpg'],
    tools: [
      ['HEIC to JPG', `Turn iPhone HEIC photos into JPG or PNG, up to 50 files in the list. Display P3 color is kept when your photo has it, and the location is removed unless you untick it.`, `${SITE}/tools/heic-to-jpg/`],
      ['Image converter', `Change an image to JPG, PNG, WebP, AVIF, GIF, BMP or TIFF. It reads HEIC, JPG, PNG, WebP, AVIF, GIF, BMP and TIFF, up to 50 files in the list.`, `${SITE}/tools/image-converter/`],
      ['MOV to MP4', `Turn a MOV video into an MP4. An H.264 video is copied as it is (fast, no re-encoding). An HEVC video, the format iPhones record by default, is re-encoded to H.264 so it plays almost anywhere, or you can choose to copy it as it is.`, `${SITE}/tools/mov-to-mp4/`],
      ['Video to GIF', `Turn part of a video into an animated GIF. Choose where it starts, how long it is, the frame rate, the width and whether it loops.`, `${SITE}/tools/video-to-gif/`],
      ['GIF to MP4', `Turn an animated GIF into an MP4 video. Choose the size, how many times the animation plays, and the color for transparent areas.`, `${SITE}/tools/gif-to-mp4/`],
    ],
    first: 'a converter',
    testNote: 'In Image converter, choose a PNG or JPG image. In MOV to MP4 or Video to GIF, choose an MP4 or MOV video. In GIF to MP4, choose an animated GIF. In HEIC to JPG, choose a HEIC photo.',
  },
  privacy: {
    ...common,
    shortDescription: "Remove the GPS location from photos before you share them, or change a photo's date, time and location. Runs in your browser.",
    singlePurpose: 'View, change or remove the location and other metadata stored in photos. The extension opens a page with two tools: remove photo location and edit photo metadata. Your files are processed inside your browser, and this extension has no server that receives them.',
    chromeCategory: 'Privacy & Security',
    edgeCategory: 'Photos',
    searchTerms: ['remove gps from photo', 'exif remover', 'photo metadata', 'exif editor', 'remove location', 'change photo date'],
    tools: [
      ['Remove photo location', `Take the GPS location out of a photo before you share it. Add up to 50 JPG or HEIC photos to the list. The tool shows what it found in each photo, removes the location (GPS, preview image, XMP and IPTC), then checks the new file and tells you whether any location is left. You can also remove everything: camera, lens, dates and more.`, `${SITE}/tools/remove-photo-location/`],
      ['Edit photo metadata', `Change a photo's date, time or location. Choose one JPG or HEIC photo, then type or paste new coordinates, set the date, time and time zone, or edit the camera make and model, author, description and copyright fields. HEIC photos are converted to JPG first, keeping the Display P3 color profile; JPG photos are edited without re-encoding. In this extension you enter coordinates by typing or pasting them; the map and place search of the web version are not included.`, `${SITE}/tools/edit-photo-metadata/`],
    ],
    first: 'a tool',
    testNote: 'In either tool, choose a JPG photo that has a GPS location.',
  },
  edit: {
    ...common,
    shortDescription: 'Crop, resize and blur photos, add a border, or put several photos into a collage or one long strip. Runs in your browser.',
    singlePurpose: 'Make simple edits to photos: crop, resize, blur, add a border or combine several photos into a collage. Your files are processed inside your browser, and this extension has no server that receives them.',
    chromeCategory: 'Art & Design',
    edgeCategory: 'Photos',
    searchTerms: ['crop image', 'resize image', 'blur image', 'photo border', 'photo collage', 'pixelate', 'long screenshot'],
    tools: [
      ['Crop image', `Crop, rotate or flip a photo. Keep any shape or pick an aspect ratio such as the original, 1:1, 4:5, 9:16 or 16:9, or type the size in pixels.`, `${SITE}/tools/crop-image/`],
      ['Resize images', `Change the width and height in pixels or percent, up to 50 files in the list, with the aspect ratio kept if you like.`, `${SITE}/tools/resize-image/`],
      ['Blur image', `Pixelate, blur or black out part of a photo. Drag across the part you want to hide, or apply it to the whole image.`, `${SITE}/tools/blur-image/`],
      ['Photo border', `Add a border, or make a photo square without cropping. Choose an even border, a card-style frame, or pad the photo to 1:1 or 4:5.`, `${SITE}/tools/photo-border/`],
      ['Photo collage', `Put several photos into one image or one long strip: up to 20 photos in a collage, or up to 30 in a long strip from top to bottom.`, `${SITE}/tools/photo-collage/`],
    ],
    first: 'a tool',
    testNote: 'In any tool, choose a JPG or PNG photo (Photo collage takes several).',
  },
};

export function description(id, name) {
  const l = LISTINGS[id];
  const tools = l.tools.map(([n, text]) => `${n}\n${text}`).join('\n\n');
  const web = l.tools.map(([n, , url]) => `${n}: ${url}`).join('\n');
  return [
    `${name} puts ${l.tools.length === 2 ? 'two' : 'five'} PicWay tools in one tab. ${LOCAL}`,
    `What's inside\n\n${tools}`,
    HOW(l.first),
    `The same tools are also on the web:\n${web}`,
    ABOUT,
  ].join('\n\n');
}
