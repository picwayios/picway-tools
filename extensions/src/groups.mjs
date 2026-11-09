// The four extensions and the tools inside each one.
// Adding a tool to an extension = adding its id to `tools` (the tool source must exist in TOOLS_SRC).
// `later` lists tools that are ready in the source but not published yet; build with
// INCLUDE_LATER=1 to try them locally. They are left out of the store builds.
export const GROUPS = [
  {
    id: 'compress',
    name: 'PicWay Image & Video Compressor',
    short: 'Compressor',
    purpose: 'Make image and video files smaller.',
    tools: ['compress-image', 'compress-video'],
    later: ['compress-gif', 'compress-video-to-size'],
  },
  {
    id: 'convert',
    name: 'PicWay Image & Video Converter',
    short: 'Converter',
    purpose: 'Change image and video files from one format to another.',
    tools: ['heic-to-jpg', 'image-converter', 'mov-to-mp4', 'video-to-gif', 'gif-to-mp4'],
    later: ['extract-frames-from-video'],
  },
  {
    id: 'privacy',
    name: 'PicWay Photo Location & Metadata',
    short: 'Metadata',
    purpose: 'View, change or remove the location and other metadata stored in photos.',
    tools: ['remove-photo-location', 'edit-photo-metadata'],
    later: ['remove-video-metadata'],
  },
  {
    id: 'edit',
    name: 'PicWay Photo Editor',
    short: 'Photo Editor',
    purpose: 'Make simple edits to photos: crop, resize, blur, add a border or combine them into a collage.',
    tools: ['crop-image', 'resize-image', 'blur-image', 'photo-border', 'photo-collage'],
    later: [],
  },
];

export const SITE = 'https://picway.app';
