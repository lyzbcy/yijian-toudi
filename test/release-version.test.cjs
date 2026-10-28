const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
test('release helper updates sidebar and about fallback without touching live source',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-release-version-'));for(const d of ['scripts','src','site','skill/yijian-toudi'])fs.mkdirSync(path.join(dir,d),{recursive:true});
 fs.copyFileSync(path.join(process.env.RELEASE_HELPER_SOURCE_ROOT||path.join(__dirname,'..'),'scripts/release.cjs'),path.join(dir,'scripts/release.cjs'));
 fs.writeFileSync(path.join(dir,'package.json'),'{"version":"0.1.0"}');fs.writeFileSync(path.join(dir,'skill/yijian-toudi/version.json'),'{"version":"0.1.0"}');
 fs.writeFileSync(path.join(dir,'src/index.html'),'<span id="appVersion">0.1.0</span>一键投递 v<span id="aboutAppVersion">0.1.0</span>');fs.writeFileSync(path.join(dir,'site/index.html'),'<html data-page-v="3">当前 v0.1.0 源码 v0.1.0 var PAGE_V=3;</html>');fs.writeFileSync(path.join(dir,'site/version.json'),'{"v":3}');
 const history="{version: '0.1.0', date:'2026-01-01',text:'original history'}";fs.writeFileSync(path.join(dir,'site/page-state.js'),'var logs = ['+history+'];');
 const r=spawnSync(process.execPath,[path.join(dir,'scripts/release.cjs'),'0.5.19'],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);const html=fs.readFileSync(path.join(dir,'src/index.html'),'utf8');assert.match(html,/<span id="appVersion">0\.5\.19<\/span>/);assert.match(html,/<span id="aboutAppVersion">0\.5\.19<\/span>/);
 const site=fs.readFileSync(path.join(dir,'site/index.html'),'utf8'),v=JSON.parse(fs.readFileSync(path.join(dir,'site/version.json'))).v;assert.equal(v,4);assert.match(site,/data-page-v="4"/);assert.match(site,/var PAGE_V=4;/);
 assert.match(site,/源码 v0\.5\.19/);const log=fs.readFileSync(path.join(dir,'site/page-state.js'),'utf8');assert.match(log,/version: '0\.5\.19'/);assert.match(log,/源码开发候选，尚未公开/);assert.ok(log.includes(history),'historical evidence preserved exactly');
});
test('release metadata schema failure leaves every version file unchanged',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-release-preflight-'));for(const d of ['scripts','src','site','skill/yijian-toudi'])fs.mkdirSync(path.join(dir,d),{recursive:true});
 fs.copyFileSync(path.join(process.env.RELEASE_HELPER_SOURCE_ROOT||path.join(__dirname,'..'),'scripts/release.cjs'),path.join(dir,'scripts/release.cjs'));
 const inputs={'package.json':'{"version":"0.1.0"}','skill/yijian-toudi/version.json':'{"version":"0.1.0"}','src/index.html':'<span id="appVersion">0.1.0</span>','site/index.html':'<html data-page-v="3">源码 v0.1.0 var PAGE_V=3;</html>','site/version.json':'{"v":3}','site/page-state.js':'const logs = [];'};
 for(const [p,data]of Object.entries(inputs))fs.writeFileSync(path.join(dir,p),data);
 const r=spawnSync(process.execPath,[path.join(dir,'scripts/release.cjs'),'0.5.19'],{encoding:'utf8',windowsHide:true});assert.equal(r.status,1);for(const [p,data]of Object.entries(inputs))assert.equal(fs.readFileSync(path.join(dir,p),'utf8'),data,p+' partially changed before validation');
});
test('release helper supports absent controller and ignores version-like comments',()=>{
 for(const withComment of [false,true]){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-release-optional-'));for(const d of ['scripts','src','site','skill/yijian-toudi'])fs.mkdirSync(path.join(dir,d),{recursive:true});
  fs.copyFileSync(path.join(process.env.RELEASE_HELPER_SOURCE_ROOT||path.join(__dirname,'..'),'scripts/release.cjs'),path.join(dir,'scripts/release.cjs'));
  for(const [p,data]of Object.entries({'package.json':'{"version":"0.1.0"}','skill/yijian-toudi/version.json':'{"version":"0.1.0"}','src/index.html':'<span id="appVersion">0.1.0</span>','site/index.html':'<html data-page-v="3">源码 v0.1.0 var PAGE_V=3;</html>','site/version.json':'{"v":3}'}))fs.writeFileSync(path.join(dir,p),data);
  if(withComment)fs.writeFileSync(path.join(dir,'site/page-state.js'),"// version: '0.5.19'\nvar logs = [{version:'0.1.0'}];");
  const r=spawnSync(process.execPath,[path.join(dir,'scripts/release.cjs'),'0.5.19'],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);
  if(withComment)assert.match(fs.readFileSync(path.join(dir,'site/page-state.js'),'utf8'),/\{ version: '0\.5\.19'/);
  else assert.equal(fs.existsSync(path.join(dir,'site/page-state.js')),false);
 }
});
