const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.FIXTURE_SOURCE_ROOT||path.resolve(__dirname,'..');
const {createWorkspaceNavigationPolicy}=require(path.join(root,'electron/navigation-policy.cjs'));
const isAllowedWorkspaceUrl=(companyId,url)=>createWorkspaceNavigationPolicy(companyId).allows(url);
test('JD observed SSO sync is exact and HTTPS',()=>{
 assert.equal(isAllowedWorkspaceUrl('jd','https://sso.jd.com/sso/sync/redirect?fixture=1'),true);
 for(const u of ['https://sso.jd.com/sso/other','https://sso.jd.com/sso/sync/redirect/extra','http://sso.jd.com/sso/sync/redirect','https://sso.jd.com.evil.test/sso/sync/redirect'])assert.equal(isAllowedWorkspaceUrl('jd',u),false,u);
});
test('JD observed connectedLogin handoff is allowed with query parameters',()=>{
 assert.equal(isAllowedWorkspaceUrl('jd','https://qq.jd.com/new/wx/connectedLogin.action?uuid=fixture&sign=fixture'),true);
});
test('JD observed newSuccessReturnPage is allowed without widening neighboring paths',()=>{
 assert.equal(isAllowedWorkspaceUrl('jd','https://qq.jd.com/new/newSuccessReturnPage.action?fixture=1'),true);
 for(const u of ['https://qq.jd.com/new/newSuccessReturnPage.action/extra','https://qq.jd.com/new/otherSuccessReturnPage.action','http://qq.jd.com/new/newSuccessReturnPage.action'])assert.equal(isAllowedWorkspaceUrl('jd',u),false,u);
});
test('JD connectedLogin allowance stays exact, HTTPS and domain-bound',()=>{
 for(const u of ['http://qq.jd.com/new/wx/connectedLogin.action','https://qq.jd.com/new/wx/connectedLogin.action/extra','https://qq.jd.com/new/qq/connectedLogin.action','https://qq.jd.com/new/wx/unconnectedLogin.action','https://qq.jd.com.evil.test/new/wx/connectedLogin.action','https://evil.test/new/wx/connectedLogin.action'])assert.equal(isAllowedWorkspaceUrl('jd',u),false,u);
});
test('JD connectedLogin does not open other companies navigation policies',()=>{
 for(const id of ['baidu','alibaba','tencent','meituan'])assert.equal(isAllowedWorkspaceUrl(id,'https://qq.jd.com/new/wx/connectedLogin.action'),false,id);
});
