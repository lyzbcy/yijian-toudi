const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {planBaiduSelections,resolveBaiduSelectionRow,buildBaiduSelectionScript,executeBaiduSelections}=require('../electron/baidu-selection-fill.cjs');
test('Baidu selection plan keeps missing facts empty, splits education segments and uses only explicit degree equivalences',()=>{
 assert.deepEqual(planBaiduSelections({}),[]);
 const plan=planBaiduSelections({basic:{gender:'保密'},education:[{school:'大学A',major:'专业A',degree:'硕士'},{school:'大学B',degree:'未知学历'}]});
 assert.equal(plan.length,6);assert.equal(plan.find(p=>p.key==='education.0.degree').option,'硕士研究生');assert.equal(plan.find(p=>p.key==='education.1.degree').option,'未知学历');assert.equal(plan.find(p=>p.key==='education.1.school').segmentIndex,1);
 assert.doesNotThrow(()=>new vm.Script(buildBaiduSelectionScript(plan[0])));
});
test('Exact structural row survives dynamic prefixes but refuses duplicate, missing, wrong route and wrong kind',()=>{
 let rows=[{classList:['brick-field','field-123-school1']}];const location={origin:'https://talent.baidu.com',pathname:'/jobs/resume/create'};
 const request={widget:'school',property:'school',segmentIndex:1};
 const run=r=>vm.runInNewContext(`(${resolveBaiduSelectionRow.toString()})(request)`,{document:{querySelectorAll:()=>rows},location,request:r});
 assert.equal(run(request),rows[0]);rows[0].classList=['brick-field','field-999-school1'];assert.equal(run(request),rows[0]);
 assert.equal(run({...request,segmentIndex:0}),null);assert.equal(run({...request,property:'major'}),null);assert.equal(run({...request,segmentIndex:1.5}),null);
 rows[0].classList=['brick-field','field-56411.-school1'];assert.equal(run(request),rows[0]);
 rows=[rows[0],rows[0]];assert.equal(run(request),null);location.pathname='/jobs/login';assert.equal(run(request),null);
});
test('Missing row reports manual failure before DOM actions; no external save/submit code is present',async()=>{
 const r=planBaiduSelections({education:[{school:'不存在的院校'}]})[0];
 const result=await vm.runInNewContext(buildBaiduSelectionScript(r),{location:{origin:'https://talent.baidu.com',pathname:'/jobs/resume/create'},document:{querySelectorAll:()=>[]}});
 assert.equal(result.written,false);assert.equal(result.error,'row-missing-or-ambiguous');
 const script=buildBaiduSelectionScript(r);assert.doesNotMatch(script,/\.submit\(|fetch\(|XMLHttpRequest/);
});
test('Ant popup activity uses owning combobox state, not a closing animation left in the DOM',async()=>{
 const r=planBaiduSelections({education:[{school:'不存在的院校'}]})[0];
 const row={classList:['field-123-school0'],getClientRects:()=>[{}],querySelectorAll:()=>[]};
 const popup={classList:{contains:c=>c==='ant-select-dropdown'},getClientRects:()=>[{}],querySelector:()=>({id:'combo-list'})};
 let expanded='false';const combo={getAttribute:n=>n==='aria-controls'?'combo-list':expanded};
 const document={querySelectorAll:s=>s==='.brick-field'?[row]:s==='input[role="combobox"]'?[combo]:[popup]};
 const env={location:{origin:'https://talent.baidu.com',pathname:'/jobs/resume/create'},document,getComputedStyle:()=>({visibility:'visible',display:'block'})};
 const inactive=await vm.runInNewContext(buildBaiduSelectionScript(r),env);assert.equal(inactive.error,'select-disabled-or-ambiguous');
 expanded='true';const active=await vm.runInNewContext(buildBaiduSelectionScript(r),env);assert.equal(active.error,'another-popup-open');
});
test('Selections execute serially and do not retry a failed workspace',async()=>{
 const requests=planBaiduSelections({education:[{school:'A',major:'B',degree:'本科'}]});let count=0,active=0,max=0;
 const workspace={async run(){count++;active++;max=Math.max(max,active);await Promise.resolve();active--;return {written:true}}};
 assert.equal((await executeBaiduSelections(workspace,requests)).length,3);assert.equal(count,3);assert.equal(max,1);
 count=0;workspace.run=async()=>{count++;throw Error('lost')};await assert.rejects(executeBaiduSelections(workspace,requests),/lost/);assert.equal(count,1);
});
function autoCompleteFixture({rollback=false}={}){
 let value='原专业',expanded='false',outside=0;
 class Input{
  get value(){return value;}set value(v){value=v;}
  getAttribute(n){return n==='aria-controls'?'major-list':expanded;}
  dispatchEvent(e){if(e.type==='input')expanded='true';if(e.key==='Escape')expanded='false';}
  focus(){}blur(){if(rollback)value='原专业';}
 }
 const input=new Input();
 const select={className:'ant-select ant-select-auto-complete',getAttribute:()=>null,classList:{contains:c=>c==='ant-select-auto-complete'},querySelector:s=>s==='input[role="combobox"]'?input:{dispatchEvent(){}}};
 const row={classList:['field-128-major0'],getClientRects:()=>[{}],querySelectorAll:()=>[select],querySelector:()=>input};
 const document={querySelectorAll:s=>s==='.brick-field'?[row]:s==='input[role="combobox"]'?[input]:[],body:{dispatchEvent(){outside++;expanded='false';}},getElementById:()=>null};
 const env={location:{origin:'https://talent.baidu.com',pathname:'/jobs/resume/create'},document,getComputedStyle:()=>({visibility:'visible',display:'block'}),HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},MouseEvent:class{constructor(type){this.type=type;}},KeyboardEvent:class{constructor(type,p){this.type=type;Object.assign(this,p);}},setTimeout:f=>f()};
 return {env,state:()=>({value,expanded,outside})};
}
test('Major AutoComplete accepts the exact literal without suggestions and closes its own query',async()=>{
 const f=autoCompleteFixture();const request=planBaiduSelections({education:[{major:'没有候选的真实专业'}]})[0];
 const result=await vm.runInNewContext(buildBaiduSelectionScript(request),f.env);
 assert.equal(result.written,true);assert.equal(result.action,'autocomplete-literal-retained');assert.equal(result.observed,request.value);
 assert.equal(f.state().value,request.value);assert.equal(f.state().expanded,'false');
});
test('Uncommitted major restores the previous query and closes a popup reopened by restoration',async()=>{
 const f=autoCompleteFixture({rollback:true});const request=planBaiduSelections({education:[{major:'新专业'}]})[0];
 const result=await vm.runInNewContext(buildBaiduSelectionScript(request),f.env);
 assert.equal(result.written,false);assert.equal(result.error,'selection-readback-mismatch');
 assert.equal(f.state().value,'原专业');assert.equal(f.state().expanded,'false');assert.ok(f.state().outside>=2);
});
test('Product prompts describe recovery in Chinese without exposing internal error codes',()=>{
 const {widgetManualReason}=require('../electron/adapters/generic-resume-fill.cjs');
 assert.match(widgetManualReason('another-popup-open'),/关闭当前选择器/);assert.doesNotMatch(widgetManualReason('unknown-internal-failure'),/unknown|internal|failure/);
});
