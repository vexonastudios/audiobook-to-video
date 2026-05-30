const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const fs = require('fs');

// Create a dummy black 100x100 pixel image
const imgBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
fs.writeFileSync('test.png', imgBuf);

const args = [
  '-loop', '1',
  '-t', '2',
  '-i', 'test.png',
  '-c:v', 'h264_nvenc',
  '-preset', 'fast',
  '-cq', '28',
  '-y', 'test_nvenc.mp4'
];

const res = spawnSync(ffmpeg, args);
console.log('STDOUT', res.stdout ? res.stdout.toString() : '');
console.log('STDERR', res.stderr ? res.stderr.toString() : '');
if (res.status === 0) {
  console.log('SUCCESS');
} else {
  console.log('FAIL CODE', res.status);
}
