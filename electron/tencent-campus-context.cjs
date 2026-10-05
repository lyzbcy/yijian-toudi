// Tencent campus uses captioned info_box rows and info_list experience groups.
function tencentCampusContext(){
  const valid=()=>location.origin==='https://join.qq.com'&&/^\/resumeedit\.html\/?$/.test(location.pathname);
  const text=e=>(e?.textContent||'').replace(/^[*＊\s]+|[*＊\s：:]+$/g,'').trim();
  const visible=e=>Boolean(e?.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const sections=title=>valid()?[...document.querySelectorAll('.send_list > .send_box')].filter(e=>text(e.querySelector(':scope > .send_title > span'))===title&&visible(e)):[];
  const groups=e=>[...e.querySelectorAll(':scope > .send_content > .experience_box > .info_list')];
  const rows=e=>[...e.querySelectorAll('.info_box')].filter(r=>r.closest('.send_box')===e);
  const caption=r=>text(r.querySelector(':scope > .subtitle'));
  const controls=r=>[...r.querySelectorAll('input,textarea,select')].filter(e=>e.closest('.info_box')===r&&!e.disabled&&!['hidden','file','button','submit'].includes(e.type));
  const widget=e=>e.readOnly||e.closest('.el-select,.el-autocomplete,.el-cascader,.el-date-editor')?'widget':['text','email','tel','number','textarea'].includes(e.type)?'text':'unsupported';
  const descriptor=e=>({tag:e.tagName,type:e.type,widget:widget(e),placeholder:e.placeholder||''});
  // ElementUI moves a dropdown to body after opening. Bind it only while it is
  // still owned by this select; never guess among global detached dropdowns.
  const ownedMenu=select=>{if(!select?.isConnected)return null;const own=[...select.querySelectorAll('.el-select-dropdown')];if(own.length>1)return null;const cache=window.__yjtTencentOwnedMenus||(window.__yjtTencentOwnedMenus=new WeakMap());if(own.length===1)cache.set(select,own[0]);const menu=own[0]||cache.get(select);return menu?.isConnected?menu:null;};
  const resolveRow=l=>{const ss=sections(l.section);if(ss.length!==1)return null;let rs=rows(ss[0]);if(l.groupNumber!==null){const gs=groups(ss[0]);if(!Number.isSafeInteger(l.groupNumber)||l.groupNumber<1)return null;const g=gs[l.groupNumber-1];rs=rs.filter(r=>r.closest('.info_list')===g);}else rs=rs.filter(r=>!r.closest('.experience_box'));rs=rs.filter(r=>caption(r)===l.label);return rs.length===1?rs[0]:null;};
  const resolve=l=>{const row=resolveRow(l);if(!row)return null;const cs=controls(row),e=cs[l.ordinal];return cs.length===l.controlCount&&e&&JSON.stringify(descriptor(e))===JSON.stringify({tag:l.tag,type:l.type,widget:l.widget,placeholder:l.placeholder})?e:null;};
  return {valid,text,visible,sections,groups,rows,caption,controls,widget,descriptor,ownedMenu,resolveRow,resolve};
}
function script(fn,arg){return `(()=>{const ctx=(${tencentCampusContext.toString()})();return (${fn.toString()})(ctx,${JSON.stringify(arg)});})()`;}
function buildTencentCampusInspectScript(){return script(ctx=>{
  const titles=['基础信息','教育经历','实习经历','项目经历','AI应用技能','语言能力','作品或个人主页','其他关键信息'],fields=[],sections=[];
  for(const section of titles){const ss=ctx.sections(section);sections.push({section,recognized:ss.length===1,groups:ss.length===1?ctx.groups(ss[0]).length:0});if(ss.length!==1)continue;const gs=ctx.groups(ss[0]);for(const row of ctx.rows(ss[0])){const group=row.closest('.experience_box')?gs.indexOf(row.closest('.info_list'))+1:null;if(group===0)continue;const cs=ctx.controls(row);for(let ordinal=0;ordinal<cs.length;ordinal++){const e=cs[ordinal],d=ctx.descriptor(e);fields.push({label:ctx.caption(row),readOnly:d.widget!=='text'||!ctx.visible(e),value:e.value,locator:{section,groupNumber:group,label:ctx.caption(row),ordinal,controlCount:cs.length,...d}});}}}
  return {ok:ctx.valid(),sections,fields};
});}
function buildTencentCampusAddScript(section,expectedGroups){return script((ctx,a)=>{const labels={'教育经历':'添加学历','实习经历':'添加实习经历','项目经历':'添加项目经历'},ss=ctx.sections(a.section);if(ss.length!==1||!labels[a.section]||ctx.groups(ss[0]).length!==a.expectedGroups)return false;const bs=[...ss[0].querySelectorAll('button')].filter(e=>ctx.text(e)===labels[a.section]&&ctx.visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');if(bs.length!==1)return false;bs[0].click();return true;},{section,expectedGroups});}
function buildTencentCampusEnableScript(section){return script((ctx,section)=>{const ss=ctx.sections(section);if(ss.length!==1||!['实习经历','项目经历'].includes(section))return {ok:false};const labels=[...ss[0].querySelectorAll(':scope > label.no_experience')];if(!labels.length)return {ok:true,changed:false};if(labels.length!==1)return {ok:false};const cs=[...labels[0].querySelectorAll('input[type=checkbox]')];if(cs.length!==1||cs[0].disabled)return {ok:false};if(!cs[0].checked)return {ok:true,changed:false};labels[0].click();return {ok:!cs[0].checked,changed:true};},section);}
function buildTencentCampusWriteScript(writes){return script((ctx,items)=>items.map(item=>{const e=ctx.resolve(item.locator);if(!e||!ctx.visible(e)||ctx.widget(e)!=='text')return {...item,written:false,error:'control-unavailable'};try{const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(!setter)throw Error();e.focus();setter.call(e,String(item.value));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.blur();return {...item,expected:String(item.value),written:true,observed:e.value};}catch{return {...item,written:false,error:'text-write-failed'};}}),writes);}
function buildTencentCampusReadbackScript(items){return script((ctx,items)=>items.map(item=>{const e=ctx.resolve(item.locator);return {...item,retained:!!e&&ctx.visible(e)&&ctx.widget(e)==='text',observed:e?.value??''};}),items);}
module.exports={tencentCampusContext,buildTencentCampusInspectScript,buildTencentCampusAddScript,buildTencentCampusEnableScript,buildTencentCampusWriteScript,buildTencentCampusReadbackScript};
