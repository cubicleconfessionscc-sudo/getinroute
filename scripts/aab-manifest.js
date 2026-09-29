// Minimal protobuf reader for an AAB base/manifest/AndroidManifest.xml.
// Pulls package, versionCode, versionName, minSdk, targetSdk, compileSdk and
// the launchable activity straight out of the binary manifest, so a .aab can be
// verified without bundletool.
//
//   node aab-manifest.js <extracted>/base/manifest/AndroidManifest.xml
const fs = require('fs');

function readVarint(buf, p) {
  let shift = 0, val = 0;
  while (p < buf.length) {
    const b = buf[p++];
    val += (b & 0x7f) * Math.pow(2, shift);
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [val, p];
}

function parse(buf) {
  const out = [];
  let p = 0;
  while (p < buf.length) {
    let tag;
    [tag, p] = readVarint(buf, p);
    const num = tag >> 3, wire = tag & 7;
    if (wire === 2) { let len; [len, p] = readVarint(buf, p); if (p + len > buf.length) break; out.push({ num, wire, data: buf.slice(p, p + len) }); p += len; }
    else if (wire === 0) { let v; [v, p] = readVarint(buf, p); out.push({ num, wire, value: v }); }
    else if (wire === 1) { out.push({ num, wire, value: buf.readBigUInt64LE(p) }); p += 8; }
    else if (wire === 5) { out.push({ num, wire, value: buf.readUInt32LE(p) }); p += 4; }
    else break;
  }
  return out;
}

const raw = (f) => (f && f.data ? f.data.toString('utf8') : undefined);
// an element name is printable ascii; aapt2 also emits binary wrapper nodes
const looksLikeName = (s) => !!s && /^[A-Za-z0-9_.:-]+$/.test(s);

function asNode(buf, depth) {
  if (depth > 24) return null;
  const f = parse(buf);
  const el = raw(f.find((x) => x.num === 3));
  if (!looksLikeName(el)) {
    // wrapper node: the real XmlNode is nested in field 1
    const inner = f.find((x) => x.num === 1 && x.wire === 2);
    return inner ? asNode(inner.data, depth + 1) : null;
  }
  const node = { element: el, attrs: {}, children: [] };
  for (const a of f.filter((x) => x.num === 4)) {
    const af = parse(a.data);
    const name = raw(af.find((x) => x.num === 2));
    let value = raw(af.find((x) => x.num === 3));
    if (value === undefined || value === '') {
      // integer/typed values live in the compiled item (field 4) as text
      const comp = af.find((x) => x.num === 4);
      if (comp) value = raw(parse(comp.data).find((x) => x.num === 3));
    }
    if (name) node.attrs[name] = value;
  }
  for (const c of f.filter((x) => x.num === 5)) {
    const child = asNode(c.data, depth + 1);
    if (child) node.children.push(child);
  }
  return node;
}

function walk(node, fn) {
  fn(node);
  for (const c of node.children) walk(c, fn);
}

const top = parse(fs.readFileSync(process.argv[2]));
const rootField = top.find((f) => f.num === 1 && f.wire === 2);
const manifestNode = asNode(rootField.data, 0);
if (!manifestNode) { console.error('could not parse manifest'); process.exit(2); }

let usesSdk = {};
let launchable = '';
let declared = [];
walk(manifestNode, (n) => {
  if (n.element === 'uses-sdk') usesSdk = n.attrs;
  if (n.element === 'activity') {
    declared.push(n.attrs.name || '');
    const main = n.children.some((c) => c.element === 'intent-filter' &&
      c.children.some((a) => a.element === 'action' && a.attrs.name === 'android.intent.action.MAIN'));
    if (main) launchable = n.attrs.name || '';
  }
});

const m = manifestNode.attrs;
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
console.log(JSON.stringify({
  package: m.package,
  rootElement: manifestNode.element,
  versionCode: num(m.versionCode),
  versionName: m.versionName,
  minSdkVersion: num(usesSdk.minSdkVersion),
  targetSdkVersion: num(usesSdk.targetSdkVersion),
  compileSdkVersion: num(m.compileSdkVersion),
  launchableActivity: launchable,
  declaredActivities: declared.length,
  elementCount: (() => { let c = 0; walk(manifestNode, () => c++); return c; })()
}, null, 2));
