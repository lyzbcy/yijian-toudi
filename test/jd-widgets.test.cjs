const test=require('node:test'),assert=require('node:assert/strict'),{planJdWidgets,buildJdWidgetScript}=require('../electron/jd-widget-fill.cjs');
test('JD widgets have no inferred required personal values',()=>assert.deepEqual(planJdWidgets({basic:{},education:[{}]}),[]));
test('false radio facts remain negative and independent segments',()=>{
 const p=planJdWidgets({education:[{degree:'本科',isDoubleDegree:false},{degree:'硕士',isHighestDegree:true}]});assert.deepEqual(p.map(r=>[r.key,r.value,r.groupNumber]),[['education.0.degree','本科',1],['education.0.isDoubleDegree','否',1],['education.1.degree','硕士',2],['education.1.isHighestDegree','是',2]]);
});
test('month and ongoing facts are not converted into fake calendar dates',()=>{
 const p=planJdWidgets({projects:[{start:'2026-08',end:'至今'}]});assert.deepEqual(p.map(r=>[r.value,r.ordinal,r.sectionId]),[['2026-08',0,'program'],['至今',1,'program']]);assert.doesNotThrow(()=>new Function('return '+buildJdWidgetScript(p)));
});

// Unit-only transport fixture unwraps the new route envelope; target guard itself is exercised with real VM realms separately.
const innerResumeScript=s=>s.includes('__yjtResumeTargetMismatch49')?s.slice(s.indexOf(';return (')+9,-6):s;
test('generic JD flow executes widget branch and rereads before text planning',async()=>{
 const {createGenericResumeFill}=require('../electron/adapters/generic-resume-fill.cjs'),{LOGIN_AND_FORM_PROBE,INSPECT_FORM_FIELDS}=require('../electron/form-inspection.cjs');
 const calls=[],workspace={openWorkspace:async()=>{},run:async script=>{script=innerResumeScript(script);calls.push(script);if(script===LOGIN_AND_FORM_PROBE)return{inputCount:2,loginRequired:false};if(script===INSPECT_FORM_FIELDS)return[{index:0,type:'input:text',label:'出生日期',readOnly:true}];if(script.includes('resolveJdWidgetRow='))return[{key:'education.0.degree',expected:'本科',observed:'本科',written:true,locator:{label:'学历层次'}}];return{skipped:true};}};
 const result=await createGenericResumeFill('jd','京东')({education:[{degree:'本科'}]},{workspace,company:{id:'jd'},recruitType:'campus'});
 assert.deepEqual(result.report.verified,['education.0.degree']);assert.deepEqual(result.report.manual,[]);assert.equal(calls.filter(s=>s===INSPECT_FORM_FIELDS).length,2);assert.equal(result.report.widgets.length,1);
});
test('JD social flow keeps its generic degree field, not campus widget filtering',async()=>{
 const {createGenericResumeFill}=require('../electron/adapters/generic-resume-fill.cjs'),{LOGIN_AND_FORM_PROBE,INSPECT_FORM_FIELDS}=require('../electron/form-inspection.cjs');let value='',campusCalled=false;
 const workspace={openWorkspace:async()=>{},run:async script=>{script=innerResumeScript(script);if(script===LOGIN_AND_FORM_PROBE)return{inputCount:1,loginRequired:false};if(script===INSPECT_FORM_FIELDS)return[{index:0,id:'level',type:'select',label:'学历',value,options:[{value:'本科',text:'本科'}]}];if(script.includes('resolveJdWidgetRow=')){campusCalled=true;throw Error('campus branch on social');}value='本科';return[{key:'education.0.degree',expected:'本科',observed:'本科',written:true,fieldIndex:0,locator:{kind:'id',value:'level'}}];}};
 const result=await createGenericResumeFill('jd','京东')({education:[{degree:'本科'}]},{workspace,company:{id:'jd'},recruitType:'social'});assert.equal(campusCalled,false);assert.deepEqual(result.report.verified,['education.0.degree']);
});
