const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.FIXTURE_SOURCE_ROOT||path.resolve(__dirname,'..');
const entryUrl='https://qq.jd.com/new/wx/login.action?ReturnUrl='+encodeURIComponent('https://campus.jd.com/#/login-callback');
const callbackUrl='https://qq.jd.com/new/wx/callback.action?code=fixture';
const landingUrl='https://www.jd.com/';
test('JD delayed scan starts handoff TTL at callback, not QR opening',()=>{
 const {createJdAuthReturnTracker}=require(path.join(root,'electron/jd-auth-return.cjs'));
 let clock=0;const t=createJdAuthReturnTracker({companyId:'jd',initialUrl:'https://campus.jd.com/#/resume',now:()=>clock});
 t.observe(entryUrl);clock=11*60*1000;t.observe(callbackUrl);
 assert.equal(t.consume(landingUrl),'https://campus.jd.com/#/login-callback');
 assert.equal(t.consume(landingUrl),null);
});
test('JD handoff still expires ten minutes after callback and cannot be revived',()=>{
 const {createJdAuthReturnTracker}=require(path.join(root,'electron/jd-auth-return.cjs'));
 let clock=0;const t=createJdAuthReturnTracker({companyId:'jd',initialUrl:'https://campus.jd.com/#/resume',now:()=>clock});
 t.observe(entryUrl);t.observe(callbackUrl);clock=10*60*1000;
 assert.equal(t.consume(landingUrl),null);
 t.observe(callbackUrl);assert.equal(t.consume(landingUrl),null);
 t.observe(entryUrl);t.observe(callbackUrl);
 clock+=10*60*1000-1;assert.equal(t.consume(landingUrl),'https://campus.jd.com/#/login-callback');
});
test('JD callback without entry, invalid re-entry and consumed callback stay closed',()=>{
 const {createJdAuthReturnTracker}=require(path.join(root,'electron/jd-auth-return.cjs'));
 const t=createJdAuthReturnTracker({companyId:'jd',initialUrl:'https://campus.jd.com/#/resume'});
 t.observe(callbackUrl);assert.equal(t.consume(landingUrl),null);
 t.observe(entryUrl);t.observe(callbackUrl);assert.ok(t.consume(landingUrl));
 t.observe(callbackUrl);assert.equal(t.consume(landingUrl),null);
 t.observe(entryUrl);t.observe('https://qq.jd.com/new/wx/login.action?ReturnUrl=https://evil.test/');
 t.observe(callbackUrl);assert.equal(t.consume(landingUrl),null);
});
test('JD automatic auth return is exact, observed and consumed once',()=>{
 const {createJdAuthReturnTracker}=require(path.join(root,'electron/jd-auth-return.cjs'));
 const make=()=>createJdAuthReturnTracker({companyId:'jd',initialUrl:'https://campus.jd.com/#/resume?type=present'});
 const entry='https://qq.jd.com/new/wx/login.action?ReturnUrl='+encodeURIComponent('https://campus.jd.com/#/login-callback');
 const t=make();assert.equal(t.consume('https://www.jd.com/'),null);
 t.observe(entry);assert.equal(t.consume('https://www.jd.com/'),null);
 t.observe('https://qq.jd.com/new/wx/callback.action?code=fixture');
 assert.equal(t.consume('https://www.jd.com.evil.test/'),null);
 assert.equal(t.consume('https://www.jd.com/other'),null);
 assert.equal(t.consume('https://www.jd.com/'),'https://campus.jd.com/#/login-callback');
 assert.equal(t.consume('https://www.jd.com/'),null);
 for(const bad of ['https://evil.test/#/login-callback','https://campus.jd.com/#/resume','https://user@campus.jd.com/#/login-callback']){
  const x=make();x.observe('https://qq.jd.com/new/wx/login.action?ReturnUrl='+encodeURIComponent(bad));x.observe('https://qq.jd.com/new/wx/callback.action');assert.equal(x.consume('https://www.jd.com/'),null);
 }
 const social=createJdAuthReturnTracker({companyId:'jd',initialUrl:'https://zhaopin.jd.com/web/login'});social.observe(entry);social.observe('https://qq.jd.com/new/wx/callback.action');assert.equal(social.consume('https://www.jd.com/'),null);
});
