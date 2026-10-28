const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('manual stages, scope, history, validation',()=>{
 const {upsert,STAGES}=require(path.join(root,'electron/career-tracker.cjs'));
 const s={activeAccountId:'a',resume:{activeProfileId:'p'},settings:{email:{address:'a@qq.com'}}};
 upsert(s,{company:'腾讯',role:'前端',stage:'待投递'},'2026-10-26T01:00:00Z');
 assert.equal(s.careerApplications.length,1);let id=s.careerApplications[0].id;
 upsert(s,{id,stage:'笔试中'},'2026-10-26T02:00:00Z');assert.equal(s.careerApplications[0].history.length,2);
 assert.throws(()=>upsert(s,{id,stage:'bad'}));s.activeAccountId='b';assert.throws(()=>upsert(s,{id,stage:'Offer'}));assert.equal(STAGES.length,7);
});
test('mail exact role matching, duplicates, old mail, no regression',()=>{
 const {upsert,syncProgress}=require(path.join(root,'electron/career-tracker.cjs'));
 const s={settings:{email:{address:'a@qq.com'}}};upsert(s,{company:'腾讯',role:'前端',stage:'已投递'},'2026-10-25T01:00:00Z');
 const m={id:'m1',mailbox:'a@qq.com',company:'腾讯',subject:'腾讯前端面试邀请',stage:'面试',receivedAt:'2026-10-26T01:00:00Z'};
 syncProgress(s,[m]);assert.equal(s.careerApplications[0].stage,'面试中');syncProgress(s,[m]);assert.equal(s.careerApplications[0].history.length,2);
 syncProgress(s,[{...m,id:'old',stage:'测评',receivedAt:'2026-10-24T01:00:00Z'}]);assert.equal(s.careerApplications[0].stage,'面试中');
 syncProgress(s,[{...m,id:'m2',stage:'测评',receivedAt:'2026-10-27T01:00:00Z'}]);assert.equal(s.careerApplications[0].stage,'面试中');
});
test('ambiguous, different mailbox, failed rejection classification',()=>{
 const {upsert,syncProgress}=require(path.join(root,'electron/career-tracker.cjs'));
 const {classifyRecruitingMail}=require(path.join(root,'electron/recruiting.cjs'));
 assert.equal(classifyRecruitingMail('面试结果：未通过',''),'结束');
 const s={settings:{email:{address:'a@qq.com'}}};for(const role of ['前端','后端'])upsert(s,{company:'腾讯',role,stage:'已投递'},'2026-10-25T01:00:00Z');
 const m={id:'m',company:'腾讯',subject:'腾讯招聘进度',mailbox:'a@qq.com',stage:'面试',receivedAt:'2026-10-26T01:00:00Z'};
 assert.equal(syncProgress(s,[m]).unmatched,1);assert.equal(s.careerApplications[0].stage,'已投递');
 syncProgress(s,[{...m,subject:'腾讯前端面试',mailbox:'b@qq.com'}]);assert.equal(s.careerApplications[0].stage,'已投递');
});

test('new confirmed applications enroll; backup restores; snapshot redacts notes and mailbox',()=>{
 const {recordConfirmed}=require('../electron/career-tracker.cjs');
 const {createBackup,restoreBackup}=require('../electron/backup.cjs');
 const {createRedactedSnapshot}=require('../electron/redact.cjs');
 const s={resume:{},settings:{email:{address:'a@qq.com'}},companies:[{id:'tencent',name:'腾讯'}],applied:[{id:'job',companyId:'tencent',title:'前端'}]};
 recordConfirmed(s,[]);assert.equal(s.careerApplications[0].stage,'已投递');
 assert.equal(s.careerApplications[0].history[0].source,'confirmed-application');
 s.careerApplications[0].note='private-note';const restored=restoreBackup(s,createBackup(s,'0.5.86'));
 assert.equal(restored.careerApplications[0].note,'private-note');
 const redacted=JSON.stringify(createRedactedSnapshot(s));assert.ok(!redacted.includes('a@qq.com'));assert.ok(!redacted.includes('private-note'));
});
