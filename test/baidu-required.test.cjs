const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {buildBaiduRequiredFieldsScript}=require('../electron/baidu-required-fields.cjs');
function row(property,{kind='text',values=[''],label='字段',checked=false,selected='',mirror=false}={}){
 const controls=values.map(value=>({type:kind==='radio'?'radio':kind==='checkbox'?'checkbox':'text',tagName:'INPUT',value,checked,getClientRects:()=>[{}]}));
 if(mirror)controls.push({type:'textarea',tagName:'TEXTAREA',value:'镜像假值',invisible:true,getClientRects:()=>[{}]});
 const selectedNode={textContent:selected,getClientRects:()=>[{}]};
 return{classList:property==='privacy'?['brick-field','sign-private-field__fixture']:['brick-field',`field-123-${property}`],getClientRects:()=>[{}],querySelector(s){if(s==='.brick-field-label-required-mark')return{};if(s.startsWith('.brick-field-label'))return{textContent:label};if(s==='.ant-select:not(.ant-select-auto-complete)')return kind==='ant'?{}:null;if(s==='.brick-select')return kind==='brick'?{}:null;return null;},querySelectorAll(s){if(s==='input,textarea,select')return controls;if(s==='.ant-select-selection-item'||s==='.brick-select-selection-selected')return[selectedNode];return[];},controls};
}
const inspect=(rows,pathname='/jobs/resume/create')=>vm.runInNewContext(buildBaiduRequiredFieldsScript(),{location:{origin:'https://talent.baidu.com',pathname},document:{querySelectorAll:()=>rows},getComputedStyle:e=>({visibility:e.invisible?'hidden':'visible',display:'block'})});
test('Required check sees model selections, ignores a school search and hidden sizing textarea',()=>{
 const r=inspect([row('school0',{kind:'ant',values:['搜索到的院校'],selected:''}),row('academic0',{kind:'brick',selected:'本科'}),row('workDesc0',{values:[''],mirror:true})]);
 assert.equal(r.requiredRows.length,3);assert.equal(r.missing.length,2);assert.equal(r.requiredRows[1].status,'filled');assert.equal(r.unknown.length,0);assert.equal(r.structurallyComplete,false);assert.equal(r.officialValidationProven,false);
});
test('Both dates are required and privacy consent is reported without changing its checked state',()=>{
 const consent=row('privacy',{kind:'checkbox',checked:false});const r=inspect([row('edudate0',{values:['2020-09','']}),consent]);
 assert.equal(r.missing.length,2);assert.equal(r.missing[1].key,'privacy-consent');assert.equal(r.missing[1].label,'隐私声明');assert.equal(consent.controls[0].checked,false);
 assert.doesNotMatch(buildBaiduRequiredFieldsScript(),/\.click\(|\.submit\(|\.checked\s*=/);
});
test('Duplicate required identities become unknown, while a complete structural sample still does not prove official validation',()=>{
 const sample=row('name',{values:['样本']});const duplicate=inspect([sample,sample]);assert.equal(duplicate.unknown.length,2);assert.equal(duplicate.structurallyComplete,false);
 const complete=inspect([sample]);assert.equal(complete.structurallyComplete,true);assert.equal(complete.officialValidationProven,false);
});
test('Missing required markers or another route does not silently claim a complete form',()=>{
 assert.equal(inspect([]).applicable,false);assert.equal(inspect([]).structurallyComplete,false);assert.equal(inspect([row('name')],'/jobs/login').applicable,false);
});
