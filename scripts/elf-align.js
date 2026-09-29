#!/usr/bin/env node
// Parses ELF program headers straight from the bytes on disk and reports, per
// ABI, the minimum PT_LOAD alignment across every .so in that directory.
//
// Why not shell out to llvm-readelf: an APK carries 64 native libraries, so the
// per-file process spawn dominated verification wall time. Reading the headers
// here is one pass over the data with no child processes at all.
//
// PT_LOAD is what the loader actually maps, so p_align is the value that
// determines whether a library can load on a 16 KB page-size device. Only
// 64-bit ABIs (arm64-v8a, x86_64) can appear on such a device; 32-bit ABIs are
// reported for information only.
'use strict';

const fs = require('fs');
const path = require('path');

const PT_LOAD = 1;

function parseElf(buf) {
  if (buf.length < 52) return null;
  if (!(buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46)) return null; // \x7fELF
  const cls = buf[4]; // 1 = 32-bit, 2 = 64-bit
  const data = buf[5]; // 1 = little endian, 2 = big endian
  if (cls !== 1 && cls !== 2) return null;
  const le = data === 1;

  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const u64 = (o) => {
    if (le) return buf.readBigUInt64LE(o);
    return buf.readBigUInt64BE(o);
  };

  // 32-bit and 64-bit ELF disagree on where e_phoff / e_phentsize live.
  const is64 = cls === 2;
  const phoff = is64 ? Number(u64(0x20)) : u32(0x1c);
  const phentsize = is64 ? u16(0x36) : u16(0x2a);
  const phnum = is64 ? u16(0x38) : u16(0x2c);
  if (!phoff || !phnum) return { class: is64 ? 64 : 32, loads: [] };

  // p_align sits at a different offset in the 32-bit and 64-bit layouts.
  const alignOff = is64 ? 0x30 : 0x1c;
  const loads = [];
  for (let i = 0; i < phnum; i++) {
    const base = phoff + i * phentsize;
    if (base + phentsize > buf.length) break;
    const pType = u32(base);
    if (pType !== PT_LOAD) continue;
    const align = is64 ? Number(u64(base + alignOff)) : u32(base + alignOff);
    loads.push(align);
  }
  return { class: is64 ? 64 : 32, loads };
}

function scanLibDir(dir) {
  const out = { count: 0, libs: [], minAlign: 0, bad: 0, unreadable: 0 };
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.so'));
  } catch {
    return null;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    let res = null;
    try {
      res = parseElf(fs.readFileSync(full));
    } catch {
      res = null;
    }
    if (!res) {
      out.unreadable++;
      continue;
    }
    const min = res.loads.length ? Math.min(...res.loads) : 0;
    out.count++;
    out.libs.push({ name, class: res.class, minAlign: min, loads: res.loads.length });
    if (min === 0) out.bad++;
    else if (out.minAlign === 0 || min < out.minAlign) out.minAlign = min;
  }
  return out;
}

const abis = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];
const root = process.argv[2];
if (!root) {
  console.error('usage: elf-align.js <extracted-root-containing lib/>');
  process.exit(2);
}
const libRoot = path.join(root, 'lib');
const result = { abis: {}, bad: [], unreadable: [], totalLibs: 0 };
for (const abi of abis) {
  const r = scanLibDir(path.join(libRoot, abi));
  if (!r) continue;
  result.abis[abi] = {
    count: r.count,
    minAlign: r.minAlign,
    minAlignHex: '0x' + r.minAlign.toString(16).toUpperCase(),
    class: r.libs.length ? r.libs[0].class : 0,
  };
  result.totalLibs += r.count;
  for (const l of r.libs) {
    if (l.minAlign === 0) result.bad.push(abi + '/' + l.name + ' no PT_LOAD segments');
  }
}
console.log(JSON.stringify(result, null, 2));
