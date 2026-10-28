'use strict';
// Real Edge rendering of complete site HTML, not a replaced page controller.
// All metadata here is explicitly an isolated loopback fixture, never a public release.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),site=path.resolve(process.env.SITE_TEST_ROOT||path.join(root,'site'));
const output=path.resolve(process.env.SITE_TEST_OUTPUT||path.join(root,'test-output/site-release'));
const html=fs.readFileSync(path.join(site,'index.html'),'utf8'),metadata=JSON.parse(fs.readFileSync(path.join(site,'version.json'),'utf8')),version=metadata.v;
const sourceVersion='0.5.95';
const checks=[],counts={},errors=[],failedRequests=[];let browser,server;
const record=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),parts=url.pathname.split('/').filter(Boolean),scenario=parts[0]||'aligned';
  const c=counts[scenario]||(counts[scenario]={pages:0,metadata:0});const leaf=parts.slice(1).join('/');
  res.setHeader('Cache-Control','no-store');
  if(!leaf||leaf==='index.html'){
   c.pages++;let body=html;
   if((scenario==='stale'&&c.pages>1)||(scenario==='bounce'&&c.pages===2))body=body.replace(/var PAGE_V\s*=\s*\d+/,`var PAGE_V=${version+1}`).replace(/data-page-v="\d+"/,`data-page-v="${version+1}"`);
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end(body);return;
  }
  if(leaf==='version.json'){
   c.metadata++;res.setHeader('Content-Type','application/json');
   if(scenario==='offline'){res.statusCode=503;res.end('{}');return;}
   if(scenario==='hang'){return;}
   res.end(JSON.stringify({v:scenario==='invalid'?String(version):['stale','persistent','storage','bounce'].includes(scenario)?version+1:version,updated:'2026-10-07'}));return;
  }
  const asset=leaf.startsWith('assets/')?path.join(root,'src',leaf):path.join(site,leaf);
  if(!asset.startsWith(path.resolve(root)+path.sep)&&!asset.startsWith(site+path.sep)){res.statusCode=403;res.end();return;}
  if(!fs.existsSync(asset)||!fs.statSync(asset).isFile()){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type',leaf.endsWith('.js')?'text/javascript; charset=utf-8':leaf.endsWith('.png')?'image/png':leaf.endsWith('.jpg')?'image/jpeg':'application/octet-stream');
  res.end(fs.readFileSync(asset));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 async function open(scenario,options={}){
  const p=await browser.newPage({viewport:options.mobile?{width:390,height:844}:{width:1440,height:1000}});
  p.on('pageerror',e=>errors.push({scenario,message:e.message}));
  p.on('requestfailed',r=>failedRequests.push({scenario,url:r.url(),error:r.failure()?.errorText}));
  if(options.noStorage)await p.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get(){throw Error('fixture-storage-denied');}}));
  await p.goto(base+'/'+scenario+'/'+(options.query?'?keep=a#agent':''),{waitUntil:'load'});await delay(options.wait||1300);return p;
 }
 let p=await open('aligned');
 record('aligned HTML/data/script/JSON versions agree',await p.getAttribute('html','data-page-v')===String(version));
 record('aligned page has no unsolicited reload',counts.aligned.pages===1,counts.aligned.pages);
 record('one version request per document',counts.aligned.metadata===1,counts.aligned.metadata);
 const hero=await p.locator('.hero-grid').innerText();
 record('release version and both platforms shown',hero.includes('0.5.95')&&hero.includes('Windows')&&hero.includes('Apple Silicon')&&hero.includes('不支持 Intel Mac'),hero);
 const link=p.locator('.hero .primary');
 record('Windows link targets official asset',(await link.getAttribute('href'))==='https://github.com/lyzbcy/yijian-toudi/releases/download/v0.5.95/yijian-toudi-setup-0.5.95.exe');
 record('Mac link targets official arm64 DMG',(await p.locator('.hero .secondary').getAttribute('href'))==='https://github.com/lyzbcy/yijian-toudi/releases/download/v0.5.95/yijian-toudi-0.5.95-arm64.dmg');
 record('installation guidance identifies limits',(await p.locator('#install-guide').innerText()).includes('未经 Apple 公证')&&(await p.locator('#install-guide').innerText()).includes('手动安装'));
 record('all images render',await p.locator('img').evaluateAll(xs=>xs.every(x=>x.complete&&x.naturalWidth>0)));
 record('desktop no horizontal overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await p.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
 await p.locator('#changelogBtn').click();
 record('changelog opens on real button click',await p.locator('#changelogDialog').evaluate(e=>e.open));
 const logs=await p.locator('#changelogList').innerText();
 record('current candidate version and date shown',logs.includes(sourceVersion)&&logs.includes(metadata.updated)&&logs.includes('正式发布'));
 record('candidate precedes older public history',logs.indexOf(sourceVersion)>=0&&logs.indexOf(sourceVersion)<logs.indexOf('0.3.1'));
 await p.locator('#changelogDialog button').click();record('changelog closes',!(await p.locator('#changelogDialog').evaluate(e=>e.open)));await p.close();
 p=await open('stale',{wait:2600});
 record('stale page refreshes once to updated HTML',counts.stale.pages===2,counts.stale.pages);
 record('stale update new data version reached',await p.getAttribute('html','data-page-v')===String(version+1));await p.close();
 p=await open('bounce',{wait:2400});
 const markerAfterNew=await p.evaluate(v=>sessionStorage.getItem('yjt:refresh-to:'+v),version+1);
 record('updated HTML retains prior target marker',markerAfterNew==='1',markerAfterNew);
 await p.locator('#forceRefreshBtn').click();await delay(1600);
 record('old HTML returned after new HTML cannot auto refresh again',counts.bounce.pages===3&&(await p.getAttribute('html','data-page-v'))===String(version),counts.bounce.pages);
 record('cache bounce requests once per document',counts.bounce.metadata===3,counts.bounce.metadata);await p.close();
 p=await open('persistent',{wait:3800});
 record('unchanged stale server does not loop',counts.persistent.pages===2,counts.persistent.pages);
 record('each stale document uses one metadata request',counts.persistent.metadata===2,counts.persistent.metadata);
 record('persistent stale page offers manual recovery',(await p.locator('#g-load').innerText()).includes('一键刷新'));await p.close();
 p=await open('offline');record('metadata error does not reload',counts.offline.pages===1);record('metadata failure requested once',counts.offline.metadata===1);await p.close();
 p=await open('hang',{wait:8700});
 record('real hung metadata fetch is aborted after eight seconds',failedRequests.some(x=>x.scenario==='hang'&&x.url.includes('version.json')&&x.error==='net::ERR_ABORTED'),failedRequests.filter(x=>x.scenario==='hang'));
 record('hung metadata stays usable without reload or repeated request',counts.hang.pages===1&&counts.hang.metadata===1,counts.hang);await p.locator('#changelogBtn').click();
 record('page controls still work after real metadata timeout',await p.locator('#changelogDialog').evaluate(e=>e.open));await p.close();
 p=await open('invalid');record('invalid string version ignored without reload',counts.invalid.pages===1);await p.close();
 p=await open('storage',{noStorage:true,wait:1600});
 record('storage unavailable does not create reload loop',counts.storage.pages===1,counts.storage.pages);
 record('storage unavailable shows manual recovery',(await p.locator('#g-load').innerText()).includes('一键刷新'));await p.close();
 p=await open('manual',{query:true});await p.locator('#forceRefreshBtn').click();await delay(1200);
 record('manual refresh navigates once',counts.manual.pages===2,counts.manual.pages);
 const u=new URL(p.url());record('manual refresh cache busts and keeps query/hash',u.searchParams.has('_refresh')&&u.searchParams.get('keep')==='a'&&u.hash==='#agent',u.href);await p.close();
 p=await open('mobile',{mobile:true});record('mobile images render',await p.locator('img').evaluateAll(xs=>xs.every(x=>x.complete&&x.naturalWidth>0)));
 record('mobile no horizontal overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.screenshot({path:path.join(output,'mobile.png'),fullPage:true});await p.close();
 record('no browser page errors',errors.length===0,errors);
 const report={at:new Date().toISOString(),siteRoot:site,pageVersion:version,isolatedMetadataFixture:true,publicReleaseVerified:false,passed:checks.filter(c=>c.pass).length,total:checks.length,checks,counts,errors,failedRequests};
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`SITE_RELEASE_BROWSER ${report.passed}/${report.total}; exit=${report.passed===report.total?0:1}`);process.exitCode=report.passed===report.total?0:1;
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));console.log('SITE_RELEASE_PREVIEW_CLOSED=true');}});
