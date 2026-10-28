const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {isAllowedWorkspaceUrl}=require('../electron/navigation-policy.cjs');
const {waitForResumeRefresh}=require('../electron/resume-upload.cjs');
test('Meituan observed WeChat callback domain accepted; similar phishing hosts rejected',()=>{
 assert.equal(isAllowedWorkspaceUrl('meituan','https://zhaopin-login.meituan.com/official-login-pc/'),true);
 assert.equal(isAllowedWorkspaceUrl('meituan','https://open.weixin.qq.com/connect/qrconnect'),true);
 assert.equal(isAllowedWorkspaceUrl('bytedance','https://open.weixin.qq.com/connect/qrconnect'),true);
 assert.equal(isAllowedWorkspaceUrl('meituan','https://zhaopin-login.meituan.com.evil.example/'),false);
 assert.equal(isAllowedWorkspaceUrl('bytedance','https://zhaopin-login.meituan.com/official-login-pc/'),false);
});
test('refresh waits for ready rather than assuming file selection is complete',async()=>{
 const states=[{phase:'awaiting-dialog'},{phase:'refreshing',confirmed:true},{phase:'ready',confirmed:true}];
 assert.deepEqual(await waitForResumeRefresh({run:async()=>states.shift()},{pollMs:1,timeoutMs:100}),{phase:'ready',confirmed:true});
});
test('refresh timeout stays manual; script errors propagate for cancellation',async()=>{
 assert.equal((await waitForResumeRefresh({run:async()=>({phase:'refreshing'})},{pollMs:1,timeoutMs:5})).phase,'manual-required');
 await assert.rejects(waitForResumeRefresh({run:async()=>{throw Error('cancelled')}}),/cancelled/);
});
test('Alibaba no longer cancels attachment refresh; generic upload precedes planning',()=>{
 const ali=fs.readFileSync(path.join(__dirname,'../electron/adapters/alibaba-fill.cjs'),'utf8');
 assert.doesNotMatch(ali,/DISMISS_REFRESH_DIALOG/);
 const source=fs.readFileSync(path.join(__dirname,'../electron/adapters/generic-resume-fill.cjs'),'utf8');
 const fill=source.slice(source.indexOf('function createGenericResumeFill'));
 assert.ok(fill.indexOf('workspace.setInputFiles')<fill.indexOf('const localPlan'));
 assert.match(fill,/attachment\.refresh\.phase !== 'ready'/);
});
