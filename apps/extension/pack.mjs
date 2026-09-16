import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
const out = path.join(root, "vod-tracker.xpi");

function u16(n) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

function u32(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n);
  return buf;
}

function dosDate(date) {
  return {
    time: (date.getSeconds() >> 1) | (date.getMinutes() << 5) | (date.getHours() << 11),
    date: date.getDate() | ((date.getMonth() + 1) << 5) | ((date.getFullYear() - 1980) << 9),
  };
}

const names = fs.readdirSync(dist).filter((name) => fs.statSync(path.join(dist, name)).isFile());
if (names.length === 0) {
  throw new Error("dist/ is empty — compile the extension before packing");
}

const now = dosDate(new Date());
const locals = [];
const centrals = [];
let offset = 0;

for (const name of names) {
  const data = fs.readFileSync(path.join(dist, name));
  const compressed = deflateRawSync(data);
  const crc = crc32(data) >>> 0;
  const nameBuf = Buffer.from(name);
  const local = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(8),
    u16(now.time),
    u16(now.date),
    u32(crc),
    u32(compressed.length),
    u32(data.length),
    u16(nameBuf.length),
    u16(0),
    nameBuf,
    compressed,
  ]);
  const central = Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(8),
    u16(now.time),
    u16(now.date),
    u32(crc),
    u32(compressed.length),
    u32(data.length),
    u16(nameBuf.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(offset),
    nameBuf,
  ]);
  locals.push(local);
  centrals.push(central);
  offset += local.length;
}

const centralBuf = Buffer.concat(centrals);
fs.writeFileSync(
  out,
  Buffer.concat([
    ...locals,
    centralBuf,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(names.length),
    u16(names.length),
    u32(centralBuf.length),
    u32(offset),
    u16(0),
  ])
);
console.log(`packed ${names.length} files → ${path.relative(process.cwd(), out)}`);
