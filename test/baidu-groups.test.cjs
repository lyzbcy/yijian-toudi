const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {buildEnsureBaiduGroupScript,executeBaiduGroups}=require('../electron/baidu-form-context.cjs');
function fixture({duplicate=false,wrongButton=false,noAdd=false}={}){
 let count=1,clicks=0;const properties=['subjectName','position','subjectDate','subjectDesc','positionDesc'];
 const rows=()=>Array.from({length:count},(_,i)=>properties.map(p=>({classList:[`field-56411.-${p}${i}`],closest:()=>section}))).flat();
 const button={textContent:wrongButton?'添加工作经历':'添加项目经验',getClientRects:()=>[{}],getAttribute:()=>null,click(){clicks++;if(!noAdd)count++;}};
 const section={querySelectorAll:s=>s==='.brick-field'?rows():[button]};
 const env={location:{origin:'https://talent.baidu.com',pathname:'/jobs/resume/create'},document:{querySelectorAll:()=>duplicate?[...rows(),...rows()]:rows()},getComputedStyle:()=>({display:'block',visibility:'visible'}),setTimeout:f=>f()};
 return {env,state:()=>({count,clicks})};
}
test('Observed project add creates exactly one complete segment per script and preserves existing groups',async()=>{
 const f=fixture();let r=await vm.runInNewContext(buildEnsureBaiduGroupScript({sectionId:'projects',count:5}),f.env);
 assert.equal(r.count,2);assert.equal(r.added,true);assert.equal(r.done,false);assert.equal(f.state().clicks,1);
 r=await vm.runInNewContext(buildEnsureBaiduGroupScript({sectionId:'projects',count:1}),f.env);assert.equal(r.count,2);assert.equal(r.added,false);assert.equal(f.state().clicks,1);
});
test('Group setup refuses duplicate identities, wrong section buttons, invalid counts and routes',async()=>{
 for(const options of [{duplicate:true},{wrongButton:true}]){
  const f=fixture(options),r=await vm.runInNewContext(buildEnsureBaiduGroupScript({sectionId:'projects',count:5}),f.env);assert.ok(r.error);assert.equal(f.state().clicks,0);
 }
 const f=fixture();const r=await vm.runInNewContext(buildEnsureBaiduGroupScript({sectionId:'projects',count:11}),f.env);assert.equal(r.error,'invalid-count');assert.equal(f.state().clicks,0);
 f.env.location.pathname='/jobs/login';assert.equal((await vm.runInNewContext(buildEnsureBaiduGroupScript({sectionId:'projects',count:5}),f.env)).skipped,true);
});
test('Host serializes additions and stops a section after the first failed click',async()=>{
 const f=fixture();const workspace={run:s=>vm.runInNewContext(s,f.env)};
 const report=await executeBaiduGroups(workspace,{projects:[{},{},{},{},{}]});assert.equal(report.sections[2].count,5);assert.equal(f.state().clicks,4);
 let calls=0;const failed=await executeBaiduGroups({run:async()=>{calls++;return {error:'group-not-added'};}},{projects:[{},{},{}]});assert.equal(calls,3);assert.equal(failed.sections[2].error,'group-not-added');
});
