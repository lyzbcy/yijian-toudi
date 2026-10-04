const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const root=process.env.RESUME_EDITOR_SOURCE_ROOT||path.resolve(__dirname,'..');
let api={};const helper=path.join(root,'src/resume-editor-values.js');if(fs.existsSync(helper))api=require(helper);
const {createUniversalResumePlan}=require(path.join(root,'electron/resume-plan.cjs')),{planJdWidgets}=require(path.join(root,'electron/jd-widget-fill.cjs'));
test('editor helper is bundled before app',()=>{const s=fs.readFileSync(path.join(root,'src/index.html'),'utf8');assert.ok(s.includes('./resume-editor-values.js'));assert.ok(s.indexOf('./resume-editor-values.js')<s.indexOf('./app.js'));});
test('explicit false stays false, unanswered stays empty',()=>{assert.equal(api.booleanAnswer('false'),false);assert.equal(api.booleanAnswer(false),false);assert.equal(api.booleanAnswer(''), '');assert.equal(api.booleanAnswer(null),'');});
test('explicit yes/string booleans supported without truthiness',()=>{assert.equal(api.booleanAnswer('true'),true);assert.equal(api.booleanAnswer('是'),true);assert.equal(api.booleanAnswer('否'),false);assert.equal(api.booleanAnswer('未知'),'未知');});
for(const [name,value,expected,end]of [
 ['month retained','2026-10',true,false],['day retained','2026-10-04',true,false],['leap day','2024-02-29',true,false],
 ['not leap day','2023-02-29',false,false],['century nonleap','1900-02-29',false,false],['century leap','2000-02-29',true,false],
 ['bad month','2026-13',false,false],['bad day','2026-04-31',false,false],['zero day','2026-01-00',false,false],
 ['unanswered allowed','',true,false],['ongoing end retained','至今',true,true],['ongoing start invalid','至今',false,false],
 ['non ISO invalid','2026/10/04',false,false],['short components invalid','2026-1-2',false,false]
])test('date '+name,()=>assert.equal(api.validResumeDate(value,end),expected));
test('same-day/year ordering and mixed precision never fabricated',()=>{assert.deepEqual(api.validateResumeDates({projects:[{start:'2026-10',end:'2026-10-01'}]}),[]);assert.equal(api.validateResumeDates({experience:[{start:'2026-10-04',end:'2026-10-03'}]}).length,1);assert.equal(api.validateResumeDates({education:[{start:'2027-01',end:'2026-12'}]}).length,1);});
test('invalid entry error names segment, excludes private raw data',()=>{const errors=api.validateResumeDates({projects:[{}, {start:'PRIVATE_BAD_DATE'}]});assert.equal(errors.length,1);assert.match(errors[0],/项目经历第2段/);assert.ok(!errors[0].includes('PRIVATE_BAD_DATE'));});
test('new education facts keep separate plan keys',()=>{const p=createUniversalResumePlan({education:[{majorCategory:'测试分类',learningMode:'测试方式',isHighestDegree:true,isDoubleDegree:false}]});assert.deepEqual(p.map(x=>[x.key,x.value]),[['education.0.majorCategory','测试分类'],['education.0.learningMode','测试方式'],['education.0.isHighestDegree','是'],['education.0.isDoubleDegree','否']]);});
test('learning-mode enum never shares fulltime yes/no keywords',()=>{const p=createUniversalResumePlan({education:[{isFullTime:true,learningMode:'非全日制'}]});const b=p.find(x=>x.key==='education.0.isFullTime'),a=p.find(x=>x.key==='education.0.learningMode');assert.ok(!b.keywords.includes('学习形式'));assert.ok(a.keywords.includes('学习形式'));});
test('JD accepts UI/imported string booleans including negative',()=>{const p=planJdWidgets({education:[{isHighestDegree:'true',isDoubleDegree:'false'}]});assert.deepEqual(p.map(r=>[r.key,r.value]),[['education.0.isHighestDegree','是'],['education.0.isDoubleDegree','否']]);});
test('new education flags default unanswered in app',()=>{const s=fs.readFileSync(path.join(root,'src/app.js'),'utf8');for(const key of ['isHighestDegree','isDoubleDegree'])assert.match(s,new RegExp("key: '"+key+"'.*options: \\['', 'true', 'false'\\]"));assert.ok(s.includes("key: 'learningMode'"));assert.ok(s.includes("key: 'majorCategory'"));});
test('all six history dates use lossless editor; false-only trailing segment retained',()=>{const s=fs.readFileSync(path.join(root,'src/app.js'),'utf8');assert.equal((s.match(/type: 'resumeDate'/g)||[]).length,6);assert.ok(s.includes("last?.[field.key] ?? ''"));assert.ok(s.includes('validateResumeDates(resume)'));});
