// Real Chromium event handlers: no Save/Submit, stable cards, added rows and retained drafts.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {_electron}=require('playwright-core');
const {JsonStore}=require('../electron/store.cjs');
const {fillAlibabaResume}=require('../electron/adapters/alibaba-fill.cjs');
const {buildAlibabaInspectScript,buildAlibabaWriteScript}=require('../electron/alibaba-form-context.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-ali-staging-')),store=new JsonStore(profile);store.init();store.update(s=>{s.meta.onboardingSeen=true;s.settings.autoCheckUpdates=false;s.settings.kimiBridgeEnabled=false;return s;});
 const app=await _electron.launch({args:[root,`--user-data-dir=${profile}`],executablePath:process.env.ELECTRON_EXECUTABLE||undefined,env:{...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
 try{
  const page=await app.firstWindow();await page.waitForSelector('.hero-card');
  const fixture=`<html><body><div id="fixture"></div><script>
   window.saved=0;window.submitted=0;window.model={};window.adds=0;
   const field=(name,label,type='text')=>'<div class="next-form-item"><label class="next-form-item-label">'+label+'</label><div><'+(type==='textarea'?'textarea':'input')+' name="'+name+'" '+(type==='textarea'?'':'type="'+type+'"')+'></'+(type==='textarea'?'textarea':'input')+'></div></div>';
   const project=prefix=>field(prefix+'.name','公司或组织名称')+field(prefix+'.responsibility','职位或职责')+field(prefix+'.description','工作描述','textarea');
   // Order deliberately differs from old numeric Edit indexes.
   for(const title of ['其他信息','附件上传','实习/项目经历','个人信息','教育情况']){
    const card=document.createElement('section');card.className='FormCard--formCard--fixture';card.innerHTML='<h2 class="FormCard--formCardTitle--fixture">'+title+'</h2><div class="body"></div><div class="FormCard--formCardFooter--fixture"><div role="button">编辑</div></div>';fixture.append(card);
    card.querySelector('[role=button]').onclick=()=>{
     const content=card.querySelector('.body');
     if(title==='个人信息')content.innerHTML=field('','姓名')+'<div class="next-form-item"><label class="next-form-item-label">手机</label><div class="next-select"><input value="country-code"></div></div>'+field('','手机')+field('','邮箱');
     if(title==='教育情况')content.innerHTML='<div class="deep-table-form-field">'+field('tfitem_99.name','公司或组织名称')+field('tfitem_99.academy','所在院系')+'<button>添加教育情况</button></div>';
     if(title==='实习/项目经历'){
      content.innerHTML='<div class="deep-table-form-field">'+project('tfitem_3')+project('tfitem_7')+'<button class="add">添加更多项目经历</button></div>';
      content.querySelector('.add').onclick=()=>{window.adds++;const node=document.createElement('div');node.innerHTML=project('tfitem_'+(20+window.adds*3));content.querySelector('.add').before(node);};
     }
     if(title==='其他信息')content.innerHTML=field('','其它','textarea');
     card.querySelector('.FormCard--formCardFooter--fixture').innerHTML='<div role="button">保存</div>';
     card.querySelector('[role=button]').onclick=()=>window.saved++;
    };
   }
   document.addEventListener('input',e=>{window.model[e.target.name||e.target.closest('.next-form-item')?.querySelector('label')?.textContent]=e.target.value;});
   const submit=document.createElement('button');submit.textContent='投递';submit.onclick=()=>window.submitted++;document.body.append(submit);
  </script></body></html>`;
  await page.setContent(fixture.replace(/<script>[\s\S]*?<\/script>/,''));
  await page.evaluate(fixture.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const resume={basic:{name:'测试姓名',phone:'13800000000',email:'test@example.invalid'},education:[{department:'测试院系'}],experience:[{company:'工作公司',role:'工作职责',description:'工作描述'}],projects:Array.from({length:5},(_,i)=>({name:'项目'+i,role:'职责'+i,description:'背景'+i,contribution:'贡献'+i,client:'客户'+i,techStack:'技术'+i})),extras:{summary:'自我评价'}};
  const run=script=>page.evaluate(script),workspace={openWorkspace:async()=>{},run};
  const result=await fillAlibabaResume(resume,{workspace,company:{id:'alibaba'},recruitType:'campus'});
  const state=await page.evaluate(()=>({saved,submitted,adds,model,organizations:[...document.querySelectorAll('input[name$=".name"]')].map(e=>e.value),countryCode:document.querySelector('.next-select input').value,saves:[...document.querySelectorAll('[role=button]')].filter(e=>e.textContent==='保存').length}));
  assert.equal(state.saved,0);assert.equal(state.submitted,0);assert.equal(state.adds,3);assert.equal(state.saves,4);assert.equal(state.countryCode,'country-code');assert.ok(state.organizations.every(v=>v===''));
  assert.equal(state.model['姓名'],'测试姓名');assert.equal(state.model['手机'],'13800000000');assert.equal(state.model['tfitem_99.academy'],'测试院系');
  assert.equal(result.report.mismatched.length,0);assert.equal(result.report.saved,false);assert.ok(result.report.manual.some(i=>i.key==='experience.0.company'));assert.equal(result.report.mappings.filter(m=>m.representation==='labeled-project-description').length,5);
  for(const [i,prefix] of ['tfitem_3','tfitem_7','tfitem_23','tfitem_26','tfitem_29'].entries()){assert.equal(state.model[prefix+'.responsibility'],'职责'+i);assert.equal(state.model[prefix+'.description'],`项目名称：项目${i}\n客户/服务客户：客户${i}\n项目背景：背景${i}\n个人贡献：贡献${i}\n技术栈：技术${i}`);}
  // Ambiguous cards must not write to an arbitrary matching input.
  const inspected=await run(buildAlibabaInspectScript('个人信息')),name=inspected.fields.find(f=>f.label==='姓名');
  await page.evaluate(()=>{const card=[...document.querySelectorAll('section')].find(c=>c.querySelector('h2').textContent==='个人信息');document.body.append(card.cloneNode(true));});
  const blocked=await run(buildAlibabaWriteScript([{key:'basic.name',value:'错误写入',locator:name.locator}]));assert.equal(blocked[0].written,false);
  const report={ok:true,version:require('../package.json').version,checks:15,saveClicks:state.saved,submitClicks:state.submitted,projectRows:5,addedRows:state.adds,visibleSaveCards:state.saves,ambiguousCardRejected:true};
  fs.mkdirSync('test-output',{recursive:true});fs.writeFileSync('test-output/alibaba-staging.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
