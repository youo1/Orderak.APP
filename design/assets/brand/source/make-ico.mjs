// Pack PNG images into one .ico (PNG-compressed entries, supported since Windows Vista and by every browser).
// Usage: node make-ico.mjs out.ico a-16.png a-32.png a-48.png
import { readFileSync, writeFileSync } from "node:fs";

const [out, ...inputs] = process.argv.slice(2);
const images = inputs.map((file) => {
  const png = readFileSync(file);
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`);
  return { png, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
});
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
const entries = [];
let offset = 6 + 16 * images.length;
for (const { png, width, height } of images) {
  const e = Buffer.alloc(16);
  e.writeUInt8(width >= 256 ? 0 : width, 0);
  e.writeUInt8(height >= 256 ? 0 : height, 1);
  e.writeUInt8(0, 2); // no palette
  e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  entries.push(e);
}
writeFileSync(out, Buffer.concat([header, ...entries, ...images.map((i) => i.png)]));
console.log(`${out}: ${images.map((i) => `${i.width}x${i.height}`).join(", ")}, ${offset} bytes`);
