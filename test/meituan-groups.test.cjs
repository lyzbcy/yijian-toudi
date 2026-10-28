'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('path'),fs=require('fs'),vm=require('vm');
const source=process.env.MEITUAN_GROUP_SOURCE_ROOT||path.resolve(__dirname,'..');let api={};try{api=require(path.join(source,'electron/meituan-groups.cjs'));}catch{}
const resume={education:[{school:'SAMPLE'}],experience:[{department:'SAMPLE'}],projects:[{name:'SAMPLE_A'},{name:'SAMPLE_B'}]};
function fixture({counts=[1,0,2],editors=1,origin='https://zhaopin.meituan.com',duplicateAdd=false,disabled=false,delay=false,changed=false,transport=false}={}){
  const specs=[['education','edu_experience_edit','添加教育经历'],['experience','work_experience_edit','添加工作/实习经历'],['projects','project_experience_edit','添加项目经历']],attrs={},clicks=[],panels=[];let delayed=null;
  const card=()=>({classList:{contains:x=>x==='model_list'}});
  for(let i=0;i<3;i++){const [key,cls,label]=specs[i],p={classList:{contains:x=>x===cls},children:Array.from({length:counts[i]},card)};
    const add={textContent:label,classList:{contains:x=>x==='list_add'},getClientRects:()=>[{}],disabled,getAttribute:()=>null,click(){clicks.push(key);const commit=()=>{p.children.unshift(card());if(changed)p.children.unshift(card());};if(delay)delayed=commit;else commit();}};p.children.push(add);if(duplicateAdd)p.children.push(add);panels.push(p);}
  const editor={children:panels,getAttribute:k=>attrs[k]||null,setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k]};
  const context=vm.createContext({document:{querySelectorAll:()=>Array.from({length:editors},()=>editor)},location:{origin,pathname:'/web/personal-center/resume-detail'}});
  const run=async script=>{if(transport&&clicks.length)throw Error('SAMPLE transport');return vm.runInContext(script,context);};
  return{run,editor,attrs,panels,clicks,context,finish:()=>{delayed?.();delayed=null;}};
}
const ensure=(f,r=resume,opts={})=>{assert.equal(typeof api.ensureMeituanGroups,'function');return api.ensureMeituanGroups(f,r,{pollMs:1,timeoutMs:8,...opts});};
test('精确三组按本机数组生成数量',()=>assert.deepEqual(api.requestedGroups(resume),[{key:'education',count:1},{key:'experience',count:1},{key:'projects',count:2}]));
test('非法非数组或超过十段不启动',async()=>{const f=fixture();await assert.rejects(()=>ensure(f,{...resume,experience:'bad'}),/group-count-invalid/);assert.deepEqual(f.clicks,[]);});
test('官网空实习卡自动添加一段后明确确认',async()=>{const f=fixture(),r=await ensure(f);assert.equal(r.complete,true);assert.deepEqual(f.clicks,['experience']);assert.deepEqual(r.added,[{key:'experience',before:0,after:1}]);assert.equal(r.pending,null);});
test('数量已经满足时不重复添加',async()=>{const f=fixture({counts:[1,1,2]}),r=await ensure(f);assert.equal(r.complete,true);assert.deepEqual(f.clicks,[]);});
test('多出的五项目保留并报告，不删或覆盖DOM值',async()=>{const f=fixture({counts:[1,1,7]}),r=await ensure(f);assert.deepEqual(r.excess,[{key:'projects',observed:7,requested:2,retained:5}]);assert.deepEqual(f.clicks,[]);assert.equal(r.complete,true);});
test('两段缺失项目逐段确认后才添加下一段',async()=>{const f=fixture({counts:[1,1,0]}),r=await ensure(f);assert.equal(r.added.length,2);assert.deepEqual(f.clicks,['projects','projects']);assert.equal(r.sections.find(x=>x.key==='projects').count,2);});
test('错误官网地址不创建卡片',async()=>{const f=fixture({origin:'https://example.invalid'}),r=await ensure(f);assert.equal(r.error,'unsupported-origin');assert.deepEqual(f.clicks,[]);});
test('普通表单没有真实编辑结构时保留旧适配',async()=>{const f=fixture({editors:0}),r=await ensure(f);assert.equal(r.skipped,true);assert.equal(r.complete,true);assert.deepEqual(f.clicks,[]);});
test('重复编辑器或添加按钮不选择第一项',async()=>{for(const opts of [{editors:2},{duplicateAdd:true}]){const f=fixture(opts),r=await ensure(f);assert.equal(r.complete,false);assert.deepEqual(f.clicks,[]);}});
test('禁用添加按钮不触发',async()=>{const f=fixture({disabled:true}),r=await ensure(f);assert.equal(r.error,'add-action-ambiguous-or-missing');assert.deepEqual(f.clicks,[]);});
test('页面数量改变时添加请求拒绝旧before',async()=>{const f=fixture({counts:[1,1,2]});const r=await f.run(api.buildMeituanGroupsScript({op:'add',key:'experience',before:0,id:'SAMPLE'}));assert.equal(r.error,'group-count-changed');assert.deepEqual(f.clicks,[]);});
test('迟迟没有增段保留pending且重复调用不重放',async()=>{const f=fixture({delay:true}),r=await ensure(f);assert.equal(r.complete,false);assert.equal(r.error,'group-add-uncertain');assert.ok(r.pending);const second=await ensure(f);assert.equal(second.error,'group-add-uncertain');assert.deepEqual(f.clicks,['experience']);});
test('迟到增段后只确认旧操作，不再点击添加',async()=>{const f=fixture({delay:true});await ensure(f);f.finish();const r=await ensure(f);assert.equal(r.complete,true);assert.equal(r.pending,null);assert.deepEqual(f.clicks,['experience']);});
test('传输未知后保留pending，不当成功',async()=>{const f=fixture({transport:true}),r=await ensure(f);assert.equal(r.error,'group-operation-uncertain');assert.equal(r.complete,false);assert.ok(f.attrs['data-yjt-group-pending']);assert.deepEqual(f.clicks,['experience']);});
test('一次意外增两段停止，不确认或再点击',async()=>{const f=fixture({changed:true}),r=await ensure(f);assert.equal(r.error,'group-count-changed');assert.equal(r.complete,false);assert.deepEqual(f.clicks,['experience']);});
test('确认必须匹配pending身份和确切加一数量',async()=>{const f=fixture({delay:true});await ensure(f);f.finish();const r=await f.run(api.buildMeituanGroupsScript({op:'ack',key:'experience',id:'OTHER'}));assert.equal(r.error,'ack-mismatch');assert.ok(f.attrs['data-yjt-group-pending']);});
test('只读检查不点击、不添加标记',async()=>{const f=fixture(),r=await f.run(api.buildMeituanGroupsScript());assert.equal(r.sections[1].count,0);assert.deepEqual(f.clicks,[]);assert.equal(Object.keys(f.attrs).length,0);});
test('生产字段前接入增段且未知结果提前返回',()=>{const s=fs.readFileSync(path.join(source,'electron/adapters/generic-resume-fill.cjs'),'utf8');assert.match(s,/sectionSetup=await ensureMeituanGroups\(workspace,resume\)/);assert.ok(s.indexOf('!sectionSetup.complete')<s.indexOf('const localPlan = createUniversalResumePlan'));assert.match(s,/sectionSetup\.excess/);assert.match(s,/\$\{structureMessage\}/);});
test('缺失或畸形检查回包不伪装普通表单跳过',async()=>{for(const value of [undefined,null,{}, {applicable:false}]){let calls=0;const r=await ensure({run:async()=>{calls++;return value;}});assert.equal(r.complete,false);assert.equal(r.error,'inspection-invalid');assert.equal(calls,1);}});
test('本机零段且官网不展示该区块时不阻断其它字段',async()=>{const f=fixture({counts:[1,0,0]});f.editor.children=f.editor.children.slice(0,1);const r=await ensure(f,{education:[{laboratory:'无'}],experience:[],projects:[]});assert.equal(r.complete,true);assert.deepEqual(f.clicks,[]);});
test('本机确有经历但官网区块丢失时停而不猜其它按钮',async()=>{const f=fixture();f.editor.children=f.editor.children.slice(0,1);const r=await ensure(f);assert.equal(r.error,'section-missing');assert.equal(r.complete,false);assert.deepEqual(f.clicks,[]);});
test('编辑器空占位段不当作真实经历',()=>{assert.deepEqual(api.requestedGroups({education:[{}],experience:[{company:'',position:'',isCurrent:false}],projects:[{name:'',description:'',id:'SAMPLE_ID'}]}).map(r=>r.count),[0,0,0]);});
test('中间空段保留编号，尾部空占位不增加需求',()=>{assert.equal(api.requestedGroups({experience:[{}, {department:'SAMPLE'}, {}]})[1].count,2);});
test('非对象经历条目明确拒绝，不猜字段',()=>assert.throws(()=>api.requestedGroups({experience:['bad']}),/group-count-invalid/));
test('实际seed空段的本科/全职等默认枚举不虚构经历',()=>{const seed=require(path.join(source,'electron/seed.cjs'));assert.deepEqual(api.requestedGroups({education:[seed.emptyEducation()],experience:[seed.emptyExperience()],projects:[seed.emptyProject()]}).map(r=>r.count),[0,0,0]);});

test('education.majorCategory单个自由事实不误判空段',()=>assert.equal(api.requestedGroups({education:[{majorCategory:'SAMPLE'}]}).find(r=>r.key==='education').count,1));

test('education.degreeName单个自由事实不误判空段',()=>assert.equal(api.requestedGroups({education:[{degreeName:'SAMPLE'}]}).find(r=>r.key==='education').count,1));

test('education.gpaBase单个自由事实不误判空段',()=>assert.equal(api.requestedGroups({education:[{gpaBase:'SAMPLE'}]}).find(r=>r.key==='education').count,1));

test('education.courses单个自由事实不误判空段',()=>assert.equal(api.requestedGroups({education:[{courses:'SAMPLE'}]}).find(r=>r.key==='education').count,1));

test('education.thesisTitle单个自由事实不误判空段',()=>assert.equal(api.requestedGroups({education:[{thesisTitle:'SAMPLE'}]}).find(r=>r.key==='education').count,1));

test('experience.level单个自由事实不误判空段',()=>assert.equal(api.requestedGroups({experience:[{level:'SAMPLE'}]}).find(r=>r.key==='experience').count,1));
