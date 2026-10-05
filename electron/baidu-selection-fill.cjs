// Observed Baidu SDK: school is Ant Select, major is Ant AutoComplete,
// education degree is a Brick select with no input, gender is Brick radio.
function planBaiduSelections(resume) {
  const result=[];
  const add=(key,value,property,segmentIndex,widget,label)=>{
    if(value===null||value===undefined||String(value).trim()==='')return;
    const expected=String(value).trim();
    const option=widget==='degree'?({硕士:'硕士研究生',博士:'博士研究生'}[expected]||expected):expected;
    result.push({key,value:expected,option,property,segmentIndex,widget,label});
  };
  add('basic.gender',resume.basic?.gender,'sex',null,'radio','性别');
  (resume.education||[]).forEach((entry,i)=>{
    add(`education.${i}.school`,entry.school,'school',i,'school','学校');
    add(`education.${i}.major`,entry.major,'major',i,'major','专业');
    add(`education.${i}.degree`,entry.degree,'academic',i,'degree','学历');
  });
  return result;
}
function resolveBaiduSelectionRow(request) {
  if(location.origin!=='https://talent.baidu.com'||!/^\/jobs\/(?:resume\/create|center)\/?$/.test(location.pathname))return null;
  const properties={school:'school',major:'major',degree:'academic',radio:'sex'};
  if(properties[request.widget]!==request.property||!(request.widget==='radio'?request.segmentIndex===null:Number.isSafeInteger(request.segmentIndex)&&request.segmentIndex>=0))return null;
  const suffix=request.property+(request.segmentIndex===null?'':request.segmentIndex);
  const rows=[...document.querySelectorAll('.brick-field')].filter(row=>[...row.classList].some(c=>/^field-\d+(?:\.\d*)?-/.test(c)&&c.split('-').at(-1)===suffix));
  return rows.length===1?rows[0]:null;
}
function buildBaiduSelectionScript(request) {
  async function execute(request) {
    const base={key:request.key,expected:request.value,locator:{kind:'baidu-selection',property:request.property,segmentIndex:request.segmentIndex,widget:request.widget,label:request.label}};
    const fail=(error,observed='')=>({...base,written:false,observed,error});
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
    const disabled=e=>!e||e.disabled||e.getAttribute('aria-disabled')==='true'||e.getAttribute('data-disabled')==='true'||/disabled/.test(String(e.className||''));
    const activePopup=e=>{
      if(!visible(e))return false;
      if(e.classList.contains('ant-select-dropdown')){
        const list=e.querySelector('[role="listbox"][id]');
        return Boolean(list&&[...document.querySelectorAll('input[role="combobox"]')].some(c=>c.getAttribute('aria-controls')===list.id&&c.getAttribute('aria-expanded')==='true'));
      }
      return true;
    };
    const otherPopups=()=>[...document.querySelectorAll('.ant-select-dropdown, .brick-select-options-popper, .brick-date-picker-panel-wrapper')].filter(activePopup);
    let input=null,ownedPopup=null,ownsInput=false,oldSearch='',succeeded=false;
    try{
      let row=resolveBaiduSelectionRow(request);
      if(!row||!visible(row))return fail('row-missing-or-ambiguous');
      if(request.widget==='radio'){
        const options=[...row.querySelectorAll('.brick-radio')].filter(e=>e.querySelector('.brick-radio-label')?.textContent.trim()===request.option);
        if(options.length!==1)return fail('radio-option-missing-or-ambiguous');
        const radio=options[0].querySelector('input[type="radio"]');
        if(disabled(radio)||disabled(options[0]))return fail('radio-disabled');
        radio.click();await pause(300);row=resolveBaiduSelectionRow(request);
        const selected=[...row?.querySelectorAll('.brick-radio')||[]].filter(e=>e.querySelector('input')?.checked);
        const observed=selected.length===1?selected[0].querySelector('.brick-radio-label')?.textContent.trim()||'':'';
        return {...base,written:observed===request.option,observed:observed===request.option?request.value:observed,error:observed===request.option?null:'radio-readback-mismatch'};
      }
      if(otherPopups().length)return fail('another-popup-open');
      if(request.widget==='degree'){
        const selections=[...row.querySelectorAll('.brick-select-selection')];
        if(selections.length!==1||disabled(selections[0]))return fail('select-disabled-or-ambiguous');
        selections[0].click();await pause(150);
        const menus=[...document.querySelectorAll('.brick-select-options-popper')].filter(visible);
        if(menus.length!==1)return fail('popup-missing-or-ambiguous');ownedPopup=menus[0];
        const options=[...ownedPopup.querySelectorAll('.brick-select-option')].filter(e=>e.querySelector('.brick-menu-item-content')?.getAttribute('title')===request.option);
        if(options.length!==1||disabled(options[0]))return fail('option-missing-ambiguous-or-disabled');
        options[0].click();await pause(300);row=resolveBaiduSelectionRow(request);
        const observed=row?.querySelector('.brick-select-selection-selected')?.textContent.trim()||'';
        if(observed!==request.option)return fail('selection-readback-mismatch',observed);
        // Verify the component's selected option after reopening.
        row.querySelector('.brick-select-selection').click();await pause(150);
        const reopened=[...document.querySelectorAll('.brick-select-options-popper')].filter(visible);
        const selected=reopened.length===1?[...reopened[0].querySelectorAll('.brick-select-option')].filter(e=>e.querySelector('.brick-menu-item-content')?.getAttribute('title')===request.option):[];
        if(selected.length!==1||!(/selected|checked/.test(selected[0].className)||selected[0].getAttribute('aria-selected')==='true'))return fail('selection-model-unproven',observed);
        succeeded=true;return {...base,written:true,observed:request.value,action:'select-reopened'};
      }
      const selects=[...row.querySelectorAll('.ant-select')];
      if(selects.length!==1||disabled(selects[0]))return fail('select-disabled-or-ambiguous');
      input=selects[0].querySelector('input[role="combobox"]');
      if(disabled(input)||input.readOnly)return fail('search-input-disabled-or-missing');
      oldSearch=input.value;
      ownsInput=true;
      selects[0].querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,request.option);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      // The observed major component is free-input Ant AutoComplete. Its model
      // accepts a literal profession even when its suggestion list has no match.
      // Standard school Select still requires an exact committed option.
      if(request.widget==='major'&&selects[0].classList.contains('ant-select-auto-complete')){
        await pause(400);input.blur();
        document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await pause(400);
        row=resolveBaiduSelectionRow(request);
        const committed=row?.querySelector('input[role="combobox"]')?.value||'';
        if(committed!==request.option)return fail('selection-readback-mismatch',committed);
        await pause(300);row=resolveBaiduSelectionRow(request);
        const retained=row?.querySelector('input[role="combobox"]')?.value||'';
        succeeded=retained===request.option;
        return {...base,written:succeeded,observed:retained,error:succeeded?null:'selection-not-retained',action:'autocomplete-literal-retained'};
      }
      const until=Date.now()+2500;let menu,options=[];
      do{
        menu=document.getElementById(input.getAttribute('aria-controls')||'')?.closest('.ant-select-dropdown');
        if(menu&&activePopup(menu)){
          ownedPopup=menu;
          // Accessibility list items contain numeric ids; click the rendered exact title.
          options=[...menu.querySelectorAll('.ant-select-item-option')].filter(e=>visible(e)&&e.getAttribute('title')===request.option&&e.querySelector('.ant-select-item-option-content')?.textContent.trim()===request.option);
          if(options.length)break;
        }
        await pause(100);
      }while(Date.now()<until);
      if(options.length!==1||disabled(options[0]))return fail('option-missing-ambiguous-or-disabled');
      options[0].click();await pause(400);row=resolveBaiduSelectionRow(request);
      const observed=request.widget==='school'?row?.querySelector('.ant-select-selection-item')?.textContent.trim()||'':row?.querySelector('input[role="combobox"]')?.value||'';
      if(observed!==request.option)return fail('selection-readback-mismatch',observed);
      // Ant AutoComplete keeps the selected label as its input value; school
      // must instead have a selected item and its search text must be cleared.
      if(request.widget==='school'&&row.querySelector('input[role="combobox"]')?.value)return fail('school-search-not-committed');
      await pause(300);row=resolveBaiduSelectionRow(request);
      const retained=request.widget==='school'?row?.querySelector('.ant-select-selection-item')?.textContent.trim():row?.querySelector('input[role="combobox"]')?.value;
      succeeded=retained===request.option;
      return {...base,written:succeeded,observed:retained||'',error:succeeded?null:'selection-not-retained',action:'exact-option-selected'};
    }catch{return fail('selection-widget-error');}
    finally{
      // Failed searches restore the previous query without selecting a fallback.
      if(ownsInput&&!succeeded){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,oldSearch);input.dispatchEvent(new Event('input',{bubbles:true}));}
      // Restoring a failed search can open a menu even when no candidate menu
      // appeared originally. Close only after this transaction acquired control.
      if(ownedPopup||ownsInput){
        if(input)input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));
        if(ownsInput)input.blur();
        document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await pause(50);
      }
    }
  }
  return `(()=>{const resolveBaiduSelectionRow=${resolveBaiduSelectionRow.toString()};return (${execute.toString()})(${JSON.stringify(request)});})()`;
}
async function executeBaiduSelections(workspace,requests) {
  const result=[];
  for(const request of requests)result.push(await workspace.run(buildBaiduSelectionScript(request)));
  return result;
}
module.exports={planBaiduSelections,resolveBaiduSelectionRow,buildBaiduSelectionScript,executeBaiduSelections};
