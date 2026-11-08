const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createZip, crc32 } = require('../src/zip.js');

test('crc32 known value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip extracts (python zipfile), keeps UTF-8 names and bytes', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
  const zip = createZip([
    { name: 'Lỗi Tracking.md', data: '# Xin chào\n![](attachments/a-1.png)\n' },
    { name: 'attachments/a-1.png', data: png },
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cge-zip-'));
  const file = path.join(dir, 'x.zip');
  fs.writeFileSync(file, zip);
  // Python's zipfile honours the UTF-8 flag (macOS's bundled `unzip` does not; Finder/ditto do).
  execFileSync('python3', ['-I', '-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', file, path.join(dir, 'out')]);
  assert.equal(fs.readFileSync(path.join(dir, 'out', 'Lỗi Tracking.md'), 'utf8'), '# Xin chào\n![](attachments/a-1.png)\n');
  assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(dir, 'out', 'attachments', 'a-1.png'))), png);
  fs.rmSync(dir, { recursive: true, force: true });
});
