const {tencentCampusContext}=require('./tencent-campus-context.cjs');
const DEGREE_ALIASES={硕士:'硕士研究生',博士:'博士研究生',专科:'大专'};
function planTencentCampusWidgets(resume){
 const requests=[],add=(key,value,section,groupNumber,label,kind,ordinal=0)=>{if(value===null||value===undefined||String(value).trim()==='')return;const sourceValue=String(value).trim();requests.push({key,value:kind==='select'?(DEGREE_ALIASES[sourceValue]||sourceValue):sourceValue,sourceValue,locator:{section,groupNumber,label,widget:kind,ordinal}});};
 (resume.education||[]).forEach((e,i)=>{add(`education.${i}.degree`,e.degree,'教育经历',i+1,'学历','select');add(`education.${i}.school`,e.school,'教育经历',i+1,'学校名称','school');});
 const dates=(key,e,section,n)=>{const first=requests.length;add(key+'.start',e.start,section,n,'起止时间','date',0);add(key+'.end',e.end,section,n,'起止时间','date',1);if(/^\d{4}-\d{2}-\d{2}$/.test(e.start)&&/^\d{4}-\d{2}-\d{2}$/.test(e.end)&&e.start>=e.end)for(const r of requests.slice(first))r.unsupportedReason='date-range-invalid';};
 for(const [group,section]of [['education','教育经历'],['projects','项目经历']]) (resume[group]||[]).forEach((e,i)=>dates(`${group}.${i}`,e,section,i+1));
 let intern=0;(resume.experience||[]).forEach((e,i)=>{if(!['实习','internship'].includes(e.employmentType))return;intern++;dates(`experience.${i}`,e,'实习经历',intern);});
 return requests;
}
function tencentWidgetContext(ctx){
 const dateVM=owner=>{for(let v=owner?.__vue__,i=0;v&&i<4;v=v.$parent,i++)if(v.$options?.name==='ElDatePicker'&&v.$el===owner)return v;return null;};
 const resolve=l=>{const row=ctx.resolveRow(l);if(!row||!ctx.visible(row))return null;
  if(l.widget==='school'){const owners=[...row.querySelectorAll('.select')].filter(e=>e.__vue__?.$options?.name==='SchoolSearch'&&e.__vue__.$props.comtype==='school'),inputs=[...row.querySelectorAll('input')];if(owners.length!==1||inputs.length!==1||!owners[0].contains(inputs[0])||inputs[0].disabled||inputs[0].readOnly)return null;return {row,owner:owners[0],input:inputs[0],model:()=>owners[0].__vue__?.$props.value};}
  if(l.widget==='select'){const owners=[...row.querySelectorAll('.el-select')],inputs=owners.length===1?[...owners[0].querySelectorAll('input.el-input__inner')]:[];if(owners.length!==1||inputs.length!==1||inputs[0].disabled||owners[0].classList.contains('is-disabled')||owners[0].__vue__?.$options?.name!=='ElSelect'||owners[0].__vue__.$props.disabled||owners[0].__vue__.$props.multiple)return null;return {row,owner:owners[0],input:inputs[0]};}
  if(l.widget==='date'){const owners=[...row.querySelectorAll('.el-date-editor')];if(owners.length!==2||![0,1].includes(l.ordinal))return null;const owner=owners[l.ordinal],v=dateVM(owner),inputs=[...owner.querySelectorAll('input')];if(!v||v.$props.type!=='date'||v.$props.valueFormat!=='yyyy-MM-dd'||!v.$props.editable||v.$props.disabled||v.$props.readonly||inputs.length!==1||inputs[0].disabled||inputs[0].readOnly)return null;return {row,owner,input:inputs[0],vm:v,model:()=>dateVM(owner)?.$props.value};}
  return null;
 };
 const fullDate=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;};
 const popupOpen=except=>[...document.querySelectorAll('.el-select-dropdown,.el-picker-panel,.el-cascader__dropdown,.content_my')].some(e=>{if(e===except||!ctx.visible(e))return false;if(e.classList.contains('content_my')){const v=e.closest('.select')?.__vue__;return v?.$options?.name==='SchoolSearch'?v.isActive!==false:true;}return true;});
 const read=item=>{const c=resolve(item.locator);if(!c)return {...item,retained:false,error:'final-widget-unavailable',observed:''};
  if(item.locator.widget==='select'){const menu=ctx.ownedMenu(c.owner),selected=menu?[...menu.querySelectorAll('.el-select-dropdown__item.selected')]:[],model=c.owner.__vue__?.$props,option=selected.length===1?selected[0].__vue__?.$props:null;const modelKnown=!!model&&Object.hasOwn(model,'value')&&!!option&&Object.hasOwn(option,'value'),modelEqual=modelKnown&&model.value===option.value,observed=selected.length===1?ctx.text(selected[0]):'';return {...item,retained:!!menu&&selected.length===1&&modelEqual&&c.input.value===observed,observed,modelKnown,modelEqual};}
  const observed=String(c.input.value),modelValue=c.model(),modelKnown=modelValue!==undefined;return {...item,retained:modelKnown&&String(modelValue)===item.expected&&observed===item.expected,observed,modelKnown,modelEqual:modelKnown&&String(modelValue)===item.expected};
 };
 return {resolve,fullDate,popupOpen,read};
}
function buildTencentCampusWidgetScript(request){
 async function perform(ctx,w,request){const base={key:request.key,expected:request.value,sourceValue:request.sourceValue,locator:request.locator,written:false,attempted:false},pause=ms=>new Promise(r=>setTimeout(r,ms)),c=w.resolve(request.locator);
  if(request.unsupportedReason)return {...base,error:request.unsupportedReason,unsupported:true};
  if(request.locator.widget==='date'&&!w.fullDate(request.value))return {...base,error:'full-date-required',unsupported:true};
  if(!c||!ctx.valid()||!ctx.visible(c.input))return {...base,error:'widget-unavailable'};
  if(request.locator.widget==='select'){
   const menu=ctx.ownedMenu(c.owner);if(!menu)return {...base,error:'owned-select-menu-unavailable'};
   if(w.popupOpen(menu))return {...base,error:'another-popup-open'};
   const previous=c.input.value,options=()=>[...menu.querySelectorAll('.el-select-dropdown__item')],exact=value=>options().filter(e=>ctx.text(e)===value),disabled=e=>e.classList.contains('is-disabled')||e.getAttribute('aria-disabled')==='true';let changed=false;
   const close=()=>c.input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));
   const restore=async()=>{const old=exact(previous);if(old.length===1&&!disabled(old[0])&&c.input.value!==previous){old[0].click();await pause(200);}return c.input.value===previous;};
   try{if(!ctx.visible(menu)){c.input.click();for(let i=0;i<20&&!ctx.visible(menu);i++)await pause(50);}if(!ctx.visible(menu))return {...base,error:'select-menu-not-open'};
    const match=exact(request.value);if(match.length!==1||disabled(match[0]))return {...base,error:match.length>1?'select-option-ambiguous':match.length?'select-option-disabled':'select-option-missing'};
    // A failed controlled update must have an existing exact option to restore.
    if(previous!==request.value&&previous&&exact(previous).length!==1)return {...base,error:'previous-selection-unavailable'};
    if(previous!==request.value){changed=true;match[0].click();}await pause(300);
    const result=w.read({...base,written:true,attempted:changed});if(!result.retained||result.observed!==request.value){const restored=await restore();return {...base,attempted:changed,error:'select-model-mismatch',restored};}
    return {...result,catalogValidationProven:true,representation:request.sourceValue===request.value?'exact-select':'explicit-degree-alias'};
   }catch{const restored=changed?await restore():true;return {...base,attempted:changed,error:'select-write-failed',restored};}finally{close();for(let i=0;i<20&&ctx.visible(menu);i++)await pause(50);}
  }
  if(w.popupOpen(null))return {...base,error:'another-popup-open'};
  const closeDate=async()=>{if(request.locator.widget!=='date')return;c.input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));c.input.blur();const p=c.vm.picker?.$el;for(let i=0;i<20&&ctx.visible(p);i++)await pause(50);};
  // In an unfocused batch window, focus() updates activeElement without firing
  // the SDK focus listener. Initialize this input's own picker through its event.
  if(request.locator.widget==='date'){c.input.click();c.input.focus();if(!c.vm.picker?.$el?.isConnected)c.input.dispatchEvent(new FocusEvent('focus',{bubbles:false}));for(let i=0;i<20&&!c.vm.picker?.$el?.isConnected;i++)await pause(50);if(!c.vm.picker?.$el?.isConnected){await closeDate();return {...base,error:'owned-date-panel-unavailable'};}}
  const previous=c.input.value,set=value=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(c.input,value);c.input.dispatchEvent(new Event('input',{bubbles:true}));c.input.dispatchEvent(new Event('change',{bubbles:true}));c.input.blur();};
  const restore=async()=>{try{if(!c.input.isConnected)return false;set(previous);await pause(200);return c.input.value===previous&&String(c.model()??'')===previous;}catch{return false;}};
  try{c.input.focus();set(request.value);await pause(request.locator.widget==='school'?650:350);const result=w.read({...base,written:true,attempted:true});if(!result.retained||result.observed!==request.value)return {...base,attempted:true,error:'widget-model-mismatch',restored:await restore()};return {...result,catalogValidationProven:false,representation:request.locator.widget==='school'?'native-school-text':'exact-full-date'};}
  catch{return {...base,attempted:true,error:'widget-write-failed',restored:await restore()};}
  finally{await closeDate();}
 }
 return `(()=>{const ctx=(${tencentCampusContext.toString()})();const w=(${tencentWidgetContext.toString()})(ctx);return (${perform.toString()})(ctx,w,${JSON.stringify(request)});})()`;
}
function buildTencentCampusWidgetReadbackScript(result){return `(()=>{const ctx=(${tencentCampusContext.toString()})();const w=(${tencentWidgetContext.toString()})(ctx);return w.read(${JSON.stringify(result)});})()`;}
module.exports={planTencentCampusWidgets,buildTencentCampusWidgetScript,buildTencentCampusWidgetReadbackScript};
