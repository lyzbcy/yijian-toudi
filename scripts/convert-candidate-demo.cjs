'use strict';
// Convert successful actual-application recordings without trimming, speed
// changes or synthetic product pixels. Historical and sealed files are retained.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const [recording, ffmpegInput] = process.argv.slice(2);
if (!recording || !ffmpegInput) throw Error('Usage: RECORDING_DIRECTORY FFMPEG_EXECUTABLE');
const directory = fs.realpathSync(recording), ffmpeg = fs.realpathSync(ffmpegInput);
const ffprobe = path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
const source = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'));
assert.equal(source.ok, true, 'Preserve failed recording reports; do not convert them into success');
assert.equal(source.candidate, true); assert.equal(source.completeDemo, false);
assert.equal(source.realApplications, 0); assert.equal(source.externalMessages, 0);
assert(/^\d+\.\d+\.\d+$/.test(source.version));
const output = path.join(directory, `一键投递-${source.version}-候选操作录像.mp4`);
assert(!fs.existsSync(output), 'Do not overwrite an existing recording');
const probe = file => JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries',
  'format=duration:stream=codec_name,width,height', '-of', 'json', file], { encoding: 'utf8', windowsHide: true }));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const raw = source.videos.map(file => {
  const resolved = fs.realpathSync(file);
  assert.equal(path.dirname(resolved), directory, 'Only this recording directory may supply source videos');
  assert(/^page@[a-f0-9]+\.webm$/.test(path.basename(resolved)), 'Unexpected raw video name');
  const metadata = probe(resolved);
  assert.equal(metadata.streams[0].width, 1280); assert.equal(metadata.streams[0].height, 900);
  return { name: path.basename(resolved), durationSeconds: Number(metadata.format.duration), sha256: hash(resolved) };
});
assert(raw.length > 0);
fs.writeFileSync(path.join(directory, 'concat-full.txt'), raw.map(item => `file '${item.name}'`).join('\n') + '\n');
fs.writeFileSync(path.join(directory, 'caption-full.txt'), `候选演示 v${source.version}  |  简历为样本  |  官网岗位实时读取  |  未正式发布`);
const font = process.platform === 'win32' ? "fontfile='C\\:/Windows/Fonts/msyh.ttc':" : '';
const filter = `pad=1280:960:0:0:black,drawtext=${font}textfile=caption-full.txt:fontcolor=white:fontsize=22:x=(w-tw)/2:y=h-40`;
const render = args => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args],
  { cwd: directory, windowsHide: true, stdio: 'inherit', timeout: 600000 });
render(['-n', '-f', 'concat', '-safe', '0', '-i', 'concat-full.txt', '-vf', filter, '-an',
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
const metadata = probe(output), duration = Number(metadata.format.duration);
assert.equal(metadata.streams[0].codec_name, 'h264');
assert.equal(metadata.streams[0].width, 1280); assert.equal(metadata.streams[0].height, 960);
assert(Math.abs(duration - raw.reduce((total, item) => total + item.durationSeconds, 0)) < 1);
// A complete codec decode checks the whole file; it is not a visual/privacy audit.
render(['-xerror', '-i', output, '-f', 'null', '-']);
const frames = path.join(directory, 'review-frames'); fs.mkdirSync(frames);
const times = [...new Set([3, 18, Math.round(raw[0].durationSeconds + 3), Math.round(duration - 25), Math.round(duration - 5)])]
  .filter(second => second >= 0 && second < duration);
for (const second of times) render(['-n', '-ss', String(second), '-i', output, '-frames:v', '1', path.join(frames, `frame-${second}.png`)]);
const report = { ...source, output: 'isolated-recording-profile', videos: raw,
  mp4: { name: path.basename(output), bytes: fs.statSync(output).size, durationSeconds: duration,
    dimensions: [1280, 960], codec: 'h264', sha256: hash(output) },
  editing: { rawPreserved: true, realTime: true, trimmed: false, accelerated: false,
    actualAppPixels: true, footerLabelsCandidateAndSample: true, audioPresent: false },
  verification: { fullCodecDecodePassed: true, extractedFrameSeconds: times,
    inspectedFrameSeconds: [], fullPlaybackInspected: false }, completeDemo: false,
};
fs.writeFileSync(path.join(directory, 'converted-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, durationSeconds: duration, frames, completeDemo: false }));
