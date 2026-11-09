// One sample input per tool. Files are synthetic test images and clips in tests/fixtures.
// start: the button that begins the work (none when the tool starts by itself).
// download: 'link' when the page shows download links, 'button' when a button saves the file.
const JPG = 'photo/gps-p3-rot6.jpg';
export const CASES = [
  { slug: 'compress-image', files: [JPG], download: 'link', expect: 'jpeg' },
  { slug: 'heic-to-jpg', files: ['photo/gps-p3.heic'], download: 'link', expect: 'jpeg' },
  { slug: 'image-converter', files: ['convert/alpha.png'], download: 'link', expect: 'webp' },
  { slug: 'resize-image', files: [JPG], download: 'link', expect: 'jpeg' },
  { slug: 'crop-image', files: [JPG], start: 'Create image', download: 'link', expect: 'jpeg' },
  {
    slug: 'blur-image', files: [JPG], start: 'Create image', download: 'link', expect: 'jpeg',
    // draw one region: drag across the middle of the picture
    before: async (page, tool) => {
      const stage = tool.locator('canvas').first();
      await stage.waitFor({ timeout: 30000 });
      // same on-screen size on every page layout, so the drag maps to the same image pixels
      await stage.evaluate((el) => ((el.style.width = '600px'), (el.style.maxWidth = 'none'), (el.style.height = 'auto')));
      const b = await stage.boundingBox();
      await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6, { steps: 5 });
      await page.mouse.up();
    },
  },
  { slug: 'photo-border', files: [JPG], download: 'button', expect: 'jpeg' },
  { slug: 'photo-collage', files: [JPG, 'convert/alpha.png'], download: 'button', expect: 'jpeg' },
  { slug: 'edit-photo-metadata', files: [JPG], download: 'button', downloadName: 'Save edited photo', expect: 'jpeg' },
  { slug: 'remove-photo-location', files: [JPG], download: 'link', expect: 'jpeg' },
  { slug: 'mov-to-mp4', files: ['video/h264-aac.mov'], start: 'Convert to MP4', download: 'link', expect: 'mp4', timeout: 120000 },
  { slug: 'compress-video', files: ['video/h264-aac.mov'], start: 'Compress', download: 'link', expect: 'mp4', timeout: 180000 },
  { slug: 'video-to-gif', files: ['video/h264.mp4'], start: 'Make GIF', download: 'link', expect: 'gif', timeout: 180000 },
  { slug: 'gif-to-mp4', files: ['video/anim.gif'], start: 'Convert to MP4', download: 'link', expect: 'mp4', timeout: 180000 },
  { slug: 'compress-gif', files: ['video/anim.gif'], start: 'Compress GIF', download: 'link', expect: 'gif', timeout: 180000 },
];
