// JD campus controls observed from the real resume page. Never default missing facts.
const {normalizeCascaderPath,fillJdCascader}=require('./jd-cascader.cjs');
function planJdWidgets(resume) {
  const requests=[];
  const add=(key,value,sectionId,groupNumber,label,kind,ordinal=0)=>{
    if(value===null||value===undefined||String(value).trim()==='')return;
    if(kind==='cascader'){const path=normalizeCascaderPath(value);requests.push({key,value:path?path.join(' / '):String(value),path,sectionId,groupNumber,label,kind,ordinal});return;}
    requests.push({key,value:value===true||value==='true'?'是':value===false||value==='false'?'否':String(value).trim(),sectionId,groupNumber,label,kind,ordinal});
  };
  const basic=resume.basic||{};
  add('basic.nativePlace',basic.nativePlace,'info',1,'籍贯','cascader');
  for(const [field,label,kind]of [['gender','性别','radio'],['nationality','国家/地区','select'],['ethnicity','民族','select'],['city','所在城市','select'],['idType','证件类型','select'],['birthday','出生日期','date']])add('basic.'+field,basic[field],'info',1,label,kind);
  (resume.education||[]).forEach((e,i)=>{
    add(`education.${i}.majorCategory`,e.majorCategory,'edu',i+1,'专业类别','cascader');
    for(const [field,label,kind]of [['school','学校名称','select'],['degree','学历层次','select'],['learningMode','学习形式','select'],['isHighestDegree','是否最高学历','radio'],['isDoubleDegree','是否双学位','radio'],['rank','专业成绩排名','select']])add(`education.${i}.${field}`,e[field],'edu',i+1,label,kind);
  });
  for(const [group,sectionId]of [['education','edu'],['experience','experience'],['projects','program']]){
    (resume[group]||[]).forEach((e,i)=>{add(`${group}.${i}.start`,e.start,sectionId,i+1,'起止时间','date',0);add(`${group}.${i}.end`,e.end,sectionId,i+1,'起止时间','date',1);});
  }
  return requests;
}

function resolveJdWidgetRow(request) {
  if(location.origin!=='https://campus.jd.com'||!/^#\/resume(?:$|[/?])/.test(location.hash))return null;
  if(!['info','edu','experience','program'].includes(request.sectionId)||!Number.isSafeInteger(request.groupNumber)||request.groupNumber<1)return null;
  const sections=[...document.querySelectorAll('[class*="gridContainer___"][id]')].filter(s=>s.id===request.sectionId);
  if(sections.length!==1)return null;
  const groups=[...sections[0].querySelectorAll('[class*="formGroupItem___"]')].filter(g=>g.closest('[class*="gridContainer___"][id]')===sections[0]);
  const group=groups[request.groupNumber-1];if(!group)return null;
  const rows=[...group.querySelectorAll('[class*="fieldItem___"]')].filter(row=>{
    const label=[...row.children].find(e=>String(e.className).includes('filedName___'));
    return(label?.textContent||'').replace(/[\s*＊:：]/g,'')===request.label;
  });
  return rows.length===1?rows[0]:null;
}

function buildJdWidgetScript(requests) {
  async function execute(requests) {
    const results=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
    const text=e=>(e?.textContent||'').trim();
    const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden]');
    const selected=select=>text(select?.querySelector('.ant-select-selection-selected-value'));
    for(const request of requests){
      const base={key:request.key,expected:request.value,locator:{kind:'jd-widget',sectionId:request.sectionId,groupNumber:request.groupNumber,label:request.label,ordinal:request.ordinal,widget:request.kind}};
      let active=null,searchInput=null,searchBefore=null,schoolSelected=false;
      const fail=error=>({...base,written:false,observed:'',error});
      try{
        let row=resolveJdWidgetRow(request);if(!row){results.push(fail('row-missing-or-ambiguous'));continue;}
        if(!visible(row)){results.push(fail('row-hidden'));continue;}
        if(request.kind==='select'){
          const selects=[...row.querySelectorAll('.ant-select')];
          if(selects.length!==1){results.push(fail('select-missing-or-ambiguous'));continue;}
          const select=selects[0],combo=select.querySelector('[role="combobox"]');
          if(!combo||select.classList.contains('ant-select-disabled')||combo.getAttribute('aria-disabled')==='true'){results.push(fail('select-disabled-or-missing'));continue;}
          if(selected(select)===request.value){results.push({...base,written:true,observed:request.value,action:'already-matching'});continue;}
          const other=[...document.querySelectorAll('[role="combobox"][aria-expanded="true"]')].filter(e=>e!==combo&&visible(e));
          if(other.length){results.push(fail('another-popup-open'));continue;}
          active=combo;
          if(combo.getAttribute('aria-expanded')!=='true')combo.click();
          // School candidates are fetched by the official readonly search API.
          // An empty dropdown has no aria-controls target until the query returns.
          if(request.sectionId==='edu'&&request.label==='学校名称'){
            const searches=[...select.querySelectorAll('input.ant-select-search__field')].filter(e=>!e.disabled&&!e.readOnly);
            if(searches.length!==1){results.push(fail('school-search-missing-or-ambiguous'));continue;}
            searchInput=searches[0];searchBefore=searchInput.value;searchInput.focus();
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(searchInput,request.value);
            searchInput.dispatchEvent(new Event('input',{bubbles:true}));
            searchInput.dispatchEvent(new Event('change',{bubbles:true}));
          }
          const until=Date.now()+(searchInput?3500:1800);let menu;
          do{menu=document.getElementById(combo.getAttribute('aria-controls')||'');if(menu&&visible(menu)&&visible(menu.closest('.ant-select-dropdown')))break;await pause(50);}while(Date.now()<until);
          if(!menu||!visible(menu)||!visible(menu.closest('.ant-select-dropdown'))){results.push(fail('associated-popup-missing'));continue;}
          const options=[...menu.querySelectorAll('[role="option"]')].filter(e=>text(e)===request.value);
          if(options.length!==1){results.push(fail(options.length?'option-ambiguous':'option-missing'));continue;}
          const option=options[0];
          if(option.getAttribute('aria-disabled')==='true'||/disabled/.test(option.className)){results.push(fail('option-disabled'));continue;}
          option.click();schoolSelected=true;await pause(400);
          row=resolveJdWidgetRow(request);const observed=selected(row?.querySelector('.ant-select'));
          results.push({...base,written:true,observed,action:'selected',error:observed===request.value?null:'readback-mismatch'});
        }else if(request.kind==='cascader'){
          results.push({...base,...await fillJdCascader(request)});
        }else if(request.kind==='radio'){
          const options=[...row.querySelectorAll('.ant-radio-wrapper')].filter(e=>text(e)===request.value);
          if(options.length!==1){results.push(fail(options.length?'radio-ambiguous':'radio-option-missing'));continue;}
          const control=options[0].querySelector('input[type="radio"]');
          if(!control||control.disabled){results.push(fail('radio-disabled-or-missing'));continue;}
          const before=control.checked;control.click();await pause(400);
          row=resolveJdWidgetRow(request);const checked=[...row?.querySelectorAll('.ant-radio-wrapper')||[]].filter(e=>e.querySelector('input[type="radio"]')?.checked);
          results.push({...base,written:true,observed:checked.length===1?text(checked[0]):'',action:before?'already-matching':'selected'});
        }else if(request.kind==='date'){
          const inputs=[...row.querySelectorAll('.ant-calendar-picker-input')],control=inputs[request.ordinal];
          if(!control||control.disabled){results.push(fail('date-control-missing'));continue;}
          const before=control.value;
          if(/^\d{4}-\d{2}$/.test(request.value)){
            results.push({...fail('date-day-required'),observed:before,monthMatches:before.slice(0,7)===request.value,action:'preserved'});continue;
          }
          if(!/^\d{4}-\d{2}-\d{2}$/.test(request.value)||new Date(request.value+'T00:00:00Z').toISOString().slice(0,10)!==request.value){results.push({...fail('date-exact-day-required'),observed:before,action:'preserved'});continue;}
          if(before===request.value){results.push({...base,written:true,observed:before,action:'already-matching'});continue;}
          const existing=[...document.querySelectorAll('.ant-calendar-picker-container')].filter(visible);
          if(existing.length){results.push(fail('another-calendar-open'));continue;}
          control.click();await pause(100);active=control;
          const popups=[...document.querySelectorAll('.ant-calendar-picker-container')].filter(visible);
          if(popups.length!==1){results.push(fail('calendar-missing-or-ambiguous'));continue;}
          const popup=popups[0],input=popup.querySelector('.ant-calendar-input');
          if(!input||input.readOnly||input.disabled){results.push(fail('calendar-input-missing'));continue;}
          // Use the site's own calendar input and commit event, not its readonly display.
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,request.value);
          input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await pause(80);
          input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));await pause(400);
          const after=resolveJdWidgetRow(request)?.querySelectorAll('.ant-calendar-picker-input')[request.ordinal]?.value||'';
          results.push({...base,written:true,observed:after,action:'calendar-input',error:after===request.value?null:'readback-mismatch'});
        }else results.push(fail('unsupported-widget'));
      }catch(e){results.push(fail('widget-error:'+e.message));}
      finally{
        if(searchInput?.isConnected&&searchBefore!==null&&!schoolSelected){
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(searchInput,searchBefore);
          searchInput.dispatchEvent(new Event('input',{bubbles:true}));
          searchInput.dispatchEvent(new Event('change',{bubbles:true}));
        }
        if(active?.isConnected){
          // Ant's search-select consumes Escape on its input, not the outer div.
          const target=searchInput?.isConnected?searchInput:active.closest('.ant-select')?.querySelector('input.ant-select-search__field')||active;
          target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));
          const until=Date.now()+1200;
          while(active.getAttribute('aria-expanded')==='true'&&Date.now()<until)await pause(50);
        }
      }
    }
    return results;
  }
  return `(()=>{const resolveJdWidgetRow=${resolveJdWidgetRow.toString()};const normalizeCascaderPath=${normalizeCascaderPath.toString()};const fillJdCascader=${fillJdCascader.toString()};return (${execute.toString()})(${JSON.stringify(requests)});})()`;
}

async function executeJdWidgets(workspace,resume){
  const requests=planJdWidgets(resume);
  // Each website script has a 15s timeout. Search and calendar animations in a
  // background window can be throttled; keep each field within its own bound.
  const results=[];
  for(const request of requests)results.push(...await workspace.run(buildJdWidgetScript([request])));
  return results;
}
function buildJdWidgetReadbackScript(results){
  function read(items){
    const visible=e=>Boolean(e?.getClientRects().length)&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden]');
    return items.map(item=>{
      if(!item.written)return item;
      const row=resolveJdWidgetRow(item.locator),kind=item.locator.widget;
      let observed='',retained=false;
      if(row&&visible(row)){
        if(kind==='select'){
          const selects=[...row.querySelectorAll('.ant-select')];
          if(selects.length===1&&visible(selects[0])){observed=(selects[0].querySelector('.ant-select-selection-selected-value')?.textContent||'').trim();retained=true;}
        }else if(kind==='radio'){
          const checked=[...row.querySelectorAll('.ant-radio-wrapper')].filter(e=>e.querySelector('input[type=radio]')?.checked);
          if(checked.length===1){observed=checked[0].textContent.trim();retained=true;}
        }else if(kind==='date'){
          const control=row.querySelectorAll('.ant-calendar-picker-input')[item.locator.ordinal];
          if(control&&visible(control)){observed=control.value;retained=true;}
        }else if(kind==='cascader'){
          const controls=[...row.querySelectorAll('.ant-cascader-input')];
          if(controls.length===1&&visible(controls[0])){const path=normalizeCascaderPath(controls[0].value);observed=path?path.join(' / '):controls[0].value;retained=true;}
        }
      }
      return {...item,observedBeforeFinalReadback:item.observed,observed,retained,error:!retained?'final-control-unavailable':observed===item.expected?null:'final-readback-mismatch'};
    });
  }
  return `(()=>{const resolveJdWidgetRow=${resolveJdWidgetRow.toString()};const normalizeCascaderPath=${normalizeCascaderPath.toString()};return (${read.toString()})(${JSON.stringify(results)});})()`;
}
module.exports={planJdWidgets,resolveJdWidgetRow,buildJdWidgetScript,executeJdWidgets,buildJdWidgetReadbackScript};
