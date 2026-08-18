const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const BROWSER_CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ]
};

function playwrightCacheCandidates(platform = process.platform, homeDirectory = os.homedir()) {
  const root = platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || homeDirectory, 'ms-playwright')
    : platform === 'darwin'
      ? path.join(homeDirectory, 'Library', 'Caches', 'ms-playwright')
      : path.join(homeDirectory, '.cache', 'ms-playwright');
  if (!fs.existsSync(root)) return [];
  const executableSuffixes = platform === 'win32'
    ? ['chrome-win/chrome.exe']
    : platform === 'darwin'
      ? [
          'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
          'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        ]
      : ['chrome-linux/chrome'];
  return fs.readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .flatMap((name) => executableSuffixes.map((suffix) => path.join(root, name, suffix)));
}

function resolveBrowserExecutable({
  explicitPath = process.env.YIJIAN_BROWSER_PATH,
  platform = process.platform,
  existsSync = fs.existsSync,
  homeDirectory = os.homedir(),
  extraCandidates = []
} = {}) {
  const candidates = [
    explicitPath,
    ...extraCandidates,
    ...(BROWSER_CANDIDATES[platform] || []),
    ...playwrightCacheCandidates(platform, homeDirectory)
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error('未找到可用的 Chrome、Edge 或 Chromium。请安装浏览器，或通过 YIJIAN_BROWSER_PATH 指定路径');
  }
  return executable;
}

module.exports = {
  BROWSER_CANDIDATES,
  playwrightCacheCandidates,
  resolveBrowserExecutable
};

