const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
function load(relative){const p=process.env.LOGIN_GATE_SOURCE?path.join(process.env.LOGIN_GATE_SOURCE,relative):path.join(root,relative);const module={exports:{}};vm.runInNewContext(fs.readFileSync(p,'utf8'),{module,exports:module.exports,require:createRequire(path.join(root,relative)),setTimeout,clearTimeout,URL},{filename:p});return module.exports;}
async function contracts(){
 const form=load('electron/form-inspection.cjs').LOGIN_AND_FORM_PROBE,ready=load('electron/workspace-diagnostics.cjs').READINESS_SCRIPT;
 const fixtures=[
  {name:'JD visible passport iframe over resume select',url:'https://campus.jd.com/#/resume',iframe:true,expected:true},
  {name:'JD hidden stale passport iframe does not block resume',url:'https://campus.jd.com/#/resume',iframe:true,hidden:true,expected:false},
  {name:'JD aria-hidden and CSS-hidden stale iframe does not block resume',url:'https://campus.jd.com/#/resume',iframe:true,ariaHidden:true,hidden:true,expected:false},
  {name:'JD aria-hidden alone still displays authentication iframe',url:'https://campus.jd.com/#/resume',iframe:true,ariaHidden:true,expected:true},
  {name:'JD unrelated visible iframe is not login',url:'https://campus.jd.com/#/resume',iframe:true,frameURL:'https://campus.jd.com/help/',expected:false},
  {name:'JD passport frame on another platform is not inferred JD auth',url:'https://jobs.bytedance.com/campus/resume/edit',iframe:true,expected:false},
  {name:'Tencent login.html checkbox is login in both probes',url:'https://join.qq.com/login.html',expected:true},
  {name:'Tencent resumeedit.html normal input is not login',url:'https://join.qq.com/resumeedit.html',expected:false},
  {name:'SSO login without input is still login',url:'https://mozi-login.alibaba-inc.com/ssoLogin.htm',noInput:true,expected:true},
  {name:'Ordinary resume phone alone is not login',url:'https://jobs.bytedance.com/campus/resume/edit',phone:true,expected:false},
  {name:'JD visible iframe with invalid src is not inferred authenticated or login',url:'https://campus.jd.com/#/resume',iframe:true,frameURL:'http://[',expected:false}
 ];
 const checks=await Promise.all(fixtures.map(async c=>{
  const input={type:'text',disabled:false,getClientRects:()=>[{}]};
  const frame={src:c.frameURL||'https://campus.jd.com/passport/?ReturnUrl=REDACTED',hidden:!!c.hidden,parentElement:null,getClientRects:()=>c.hidden?[]:[{}],getAttribute:n=>n==='aria-hidden'?(c.ariaHidden?'true':null):n==='src'?frame.src:null};
  const document={title:'招聘',readyState:'complete',body:{innerText:'招聘信息来源 简历附件'},querySelectorAll:s=>s==='iframe'?(c.iframe?[frame]:[]):(s.includes('input')?(c.noInput?[]:[input]):[]),querySelector:s=>c.phone&&s.includes('autocomplete="tel"')?input:null};
  const context={document,location:new URL(c.url),URL,Promise,Date,setInterval,clearInterval,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})};
  const a=await vm.runInNewContext(form,context),b=vm.runInNewContext(ready,context);
  return {name:c.name,expected:c.expected,form:a.loginRequired,diagnostic:b.loginRequired,ok:a.loginRequired===c.expected&&b.loginRequired===c.expected};
 }));
 return {at:new Date().toISOString(),checks,passed:checks.filter(c=>c.ok).length,total:checks.length,scope:'two actual production script strings in VM with controlled parent DOM; not actual site login/save',officialOperations:0};
}
if(require.main===module)contracts().then(r=>{if(process.env.LOGIN_GATE_OUTPUT)fs.writeFileSync(process.env.LOGIN_GATE_OUTPUT,JSON.stringify(r,null,2)+'\n',{flag:'wx'});console.log('LOGIN_GATE '+r.passed+'/'+r.total+'; productionScripts=true; controlledDOM=true; officialWrites0');process.exitCode=r.passed===r.total?0:1}).catch(e=>{console.error(e);process.exitCode=1});
module.exports={contracts};
