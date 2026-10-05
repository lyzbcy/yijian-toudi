const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {getBaiduFormContext,resolveBaiduFormControl}=require('../electron/baidu-form-context.cjs');
const {planGenericResumeFields,mergeExecutionWithInspection}=require('../electron/adapters/generic-resume-fill.cjs');
const {planBaiduMonths,buildBaiduMonthScript,executeBaiduMonths}=require('../electron/baidu-month-fill.cjs');
const {INSPECT_FORM_FIELDS}=require('../electron/form-inspection.cjs');
function fixture(property,{prefix=123,segment=0,count=1,mirror=false,select=false}={}){
 const row={classList:['brick-field',`field-${prefix}-${property}${segment===null?'':segment}`],querySelector:()=>({textContent:'起止时间'}),querySelectorAll:()=>controls};
 const controls=Array.from({length:count+(mirror?1:0)},(_,i)=>({tagName:mirror?'TEXTAREA':'INPUT',type:'text',placeholder:count===2?(i===0?'请选择开始时间':'请选择结束时间'):'',value:'',disabled:false,readOnly:false,hidden:mirror&&i===count,closest:s=>s==='.brick-field'?row:s==='.ant-select, .brick-select'&&select?{}:null,getClientRects:()=>[{}]}));
 const environment={location:{origin:'https://talent.baidu.com',pathname:'/jobs/resume/create'},document:{querySelectorAll:()=>[row]},getComputedStyle:c=>({visibility:c.hidden?'hidden':'visible',display:'block'})};
 const context=c=>vm.runInNewContext(`(${getBaiduFormContext.toString()})(control)`,{...environment,control:c});
 const resolve=locator=>vm.runInNewContext(`(${resolveBaiduFormControl.toString()})(locator)`,{...environment,locator});
 return {row,controls,environment,context,resolve};
}
test('Baidu structural identity separates project/work dates, start/end and segment numbers despite identical captions',()=>{
 for(const [property,group]of [['edudate','education'],['workdate','experience'],['subjectDate','projects']]){
  const f=fixture(property,{segment:1,count:2});
  assert.equal(f.context(f.controls[0]).key,`${group}.1.start`);
  assert.equal(f.context(f.controls[1]).key,`${group}.1.end`);
  assert.equal(f.resolve(f.context(f.controls[1])),f.controls[1]);
 }
});
test('Baidu resolves after dynamic prefix changes but rejects duplicate rows, changed placeholders and wrong routes',()=>{
 const f=fixture('subjectName');const locator=f.context(f.controls[0]);
 f.row.classList=['brick-field','field-999999-subjectName0'];assert.equal(f.resolve(locator),f.controls[0]);
 f.environment.document.querySelectorAll=()=>[f.row,f.row];assert.equal(f.resolve(locator),null);
 f.environment.document.querySelectorAll=()=>[f.row];f.controls[0].placeholder='改版';assert.equal(f.resolve(locator),null);
 f.environment.location.pathname='/jobs/login';assert.equal(f.resolve(locator),null);assert.equal(f.context(f.controls[0]),null);
});
test('Hidden sizing textarea does not shift semantic ordinal; school search stays a select',()=>{
 const f=fixture('subjectDesc',{mirror:true});
 assert.equal(f.context(f.controls[0]).key,'projects.0.description');assert.equal(f.context(f.controls[1]).hidden,true);
 assert.equal(f.context(f.controls[1]).ordinal,-1);assert.equal(f.resolve(f.context(f.controls[0])),f.controls[0]);
 const school=fixture('school',{select:true});assert.equal(school.context(school.controls[0]).widgetKind,'select');
});
test('Baidu numeric form prefix can include the observed trailing decimal separator',()=>{
 for(const prefix of ['56411.','56411.12']){
  const f=fixture('subjectDate',{prefix,count:2});const locator=f.context(f.controls[1]);
  assert.equal(locator.key,'projects.0.end');assert.equal(f.resolve(locator),f.controls[1]);
 }
});
test('An unrecognized Baidu form never falls back to caption-based writing',()=>{
 const f=fixture('subjectName');f.row.classList=['brick-field','field-unknown-subjectName0'];
 const input=f.controls[0];input.placeholder='项目名称';input.getAttribute=()=>null;
 f.environment.document.querySelectorAll=()=>[input];
 const fields=vm.runInNewContext(INSPECT_FORM_FIELDS,f.environment);
 assert.equal(fields[0].baiduLocator,null);assert.equal(fields[0].readOnly,true);
 assert.equal(planGenericResumeFields([{key:'projects.0.name',value:'不能误写',keywords:['项目名称']}],fields).writable.length,0);
});
test('Baidu planner refuses ambiguous same-shaped fields and never falls back to another resume key',()=>{
 const f=fixture('subjectName');const locator=f.context(f.controls[0]);
 const fields=[{index:0,type:'input:text',value:'',label:'项目名称 公司名称',section:'项目经历-1',baiduLocator:locator}];
 const plan=[{key:'projects.0.name',value:'新项目',keywords:['项目名称']},{key:'experience.0.company',value:'公司',keywords:['公司名称']}];
 const result=planGenericResumeFields(plan,fields);assert.equal(result.writable.length,1);assert.equal(result.writable[0].locator.kind,'baidu-context');assert.equal(result.manual[0].key,'experience.0.company');
 assert.equal(planGenericResumeFields(plan,[...fields,{...fields[0],index:1}]).writable.length,0);
 const execution=[{key:'projects.0.name',expected:'新项目',observed:'新项目',written:true,locator:result.writable[0].locator}];
 assert.equal(mergeExecutionWithInspection(execution,[{...fields[0],index:7,value:'新项目'}])[0].observed,'新项目');
 assert.equal(mergeExecutionWithInspection(execution,[...fields,{...fields[0],index:1}])[0].observed,'');
});
test('Month planner scopes six dates and refuses duplicate controls',()=>{
 const f=fixture('subjectDate',{count:2});const fields=f.controls.map((c,index)=>({index,baiduLocator:f.context(c)}));
 const plan=[{key:'projects.0.start',value:'2023-09'},{key:'projects.0.end',value:'2024-06'}];
 assert.equal(planBaiduMonths(plan,fields).length,2);assert.equal(planBaiduMonths(plan,[...fields,fields[0]]).length,1);
 assert.doesNotThrow(()=>new vm.Script(buildBaiduMonthScript(planBaiduMonths(plan,fields))));assert.doesNotThrow(()=>new vm.Script(INSPECT_FORM_FIELDS));
});
test('Month driver preserves full dates, invalid months and present values without touching DOM',async()=>{
 let touched=0;
 const document={querySelectorAll(){touched++;return[]}};
 const requests=['2024-06-01','2024-13'].map((value,i)=>({key:String(i),value,locator:{}}));
 const result=await vm.runInNewContext(buildBaiduMonthScript(requests),{document});
 assert.equal(touched,0);assert.ok(result.every(r=>!r.written&&r.error==='month-precision-required'));
});
test('Ongoing work dates remain an explicit manual fact without inventing a month',async()=>{
 let touched=0;const document={querySelectorAll(){touched++;return[]}};
 const result=await vm.runInNewContext(buildBaiduMonthScript(['至今','Present','current','ongoing'].map(value=>({value,locator:{}}))),{document});
 assert.equal(touched,0);assert.ok(result.every(r=>!r.written&&r.error==='ongoing-date-manual'));
 const {widgetManualReason}=require('../electron/adapters/generic-resume-fill.cjs');assert.match(widgetManualReason(result[0].error),/至今/);
});
test('Month driver leaves another open calendar untouched instead of acting on its controls',async()=>{
 const f=fixture('subjectDate',{count:2});const locator=f.context(f.controls[0]);let bodyTouches=0;
 const popup={getClientRects:()=>[{}]};
 f.environment.document={querySelectorAll:s=>s==='.brick-field'?[f.row]:[popup],get body(){bodyTouches++;throw Error('must not close somebody else’s calendar')}};
 const result=await vm.runInNewContext(buildBaiduMonthScript([{key:locator.key,value:'2023-09',locator}]),f.environment);
 assert.equal(result[0].error,'another-calendar-open');assert.equal(result[0].written,false);assert.equal(bodyTouches,0);
});
test('SDK transactions run one at a time and stop on workspace failure without replay',async()=>{
 let calls=0,active=0,max=0;
 const requests=[1,2,3].map(i=>({key:String(i),value:'2024-06',locator:{}}));
 const workspace={async run(){calls++;active++;max=Math.max(max,active);await Promise.resolve();active--;return [{written:true}]}};
 assert.equal((await executeBaiduMonths(workspace,requests)).length,3);assert.equal(max,1);assert.equal(calls,3);
 calls=0;workspace.run=async()=>{calls++;throw Error('workspace-lost')};
 await assert.rejects(executeBaiduMonths(workspace,requests),/workspace-lost/);assert.equal(calls,1);
});
