const {resolveBaiduFormControl}=require('./baidu-form-context.cjs');

function planBaiduMonths(plan,fields) {
  return plan.flatMap(item=>{
    const candidates=fields.filter(f=>f.baiduLocator?.key===item.key&&f.baiduLocator.widgetKind==='month'&&!f.baiduLocator.hidden);
    return candidates.length===1?[{key:item.key,value:String(item.value),locator:{kind:'baidu-month',...candidates[0].baiduLocator}}]:[];
  });
}
function buildBaiduMonthScript(requests) {
  async function execute(requests) {
    const results=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
    const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
    const panels=()=>[...document.querySelectorAll('.brick-date-picker-panel-wrapper')].filter(visible);
    const disabled=e=>e?.getAttribute('data-disabled')==='true'||e?.getAttribute('aria-disabled')==='true'||e?.disabled||/disabled/.test(String(e?.className||''));
    for(const request of requests){
      const base={key:request.key,expected:request.value,locator:request.locator};
      const fail=(error,observed='')=>({...base,written:false,observed,error});
      let ownsPanel=false;
      try{
        if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(request.value)){results.push(fail('month-precision-required'));continue;}
        let control=resolveBaiduFormControl(request.locator);
        if(!control){results.push(fail('control-missing-or-ambiguous'));continue;}
        if(panels().length){results.push(fail('another-calendar-open',control.value));continue;}
        const picker=control.closest('.brick-date-picker'),icon=picker?.querySelector('.brick-calender-icon');
        if(!picker||!icon||!visible(icon)||disabled(picker)||disabled(icon)){results.push(fail('picker-disabled-or-missing',control.value));continue;}
        icon.click();ownsPanel=true;await pause(100);
        let opened=panels();
        if(opened.length!==1||opened[0].getAttribute('data-content-type')!=='month'){results.push(fail('month-panel-missing-or-ambiguous'));continue;}
        const [year,month]=request.value.split('-');
        const years=[...opened[0].querySelectorAll('.brick-aside-item')].filter(e=>e.textContent.trim()===year&&visible(e));
        if(years.length!==1||disabled(years[0])){results.push(fail('year-option-missing-or-disabled',control.value));continue;}
        years[0].click();await pause(100);opened=panels();
        if(opened.length!==1||opened[0].querySelector('.brick-title-text')?.textContent.trim()!==year+'年'){results.push(fail('year-readback-mismatch'));continue;}
        const months=[...opened[0].querySelectorAll('.brick-content-item')].filter(e=>e.textContent.trim()===Number(month)+'月'&&visible(e));
        if(months.length!==1||disabled(months[0])){results.push(fail('month-option-missing-or-disabled',control.value));continue;}
        months[0].click();await pause(400);
        control=resolveBaiduFormControl(request.locator);const observed=control?.value||'';
        if(observed!==request.value||panels().length){results.push(fail('month-readback-mismatch',observed));continue;}
        // Reopen the real component: selected model must agree with display text.
        control.closest('.brick-date-picker').querySelector('.brick-calender-icon').click();await pause(100);
        opened=panels();
        const selected=opened.length===1?[...opened[0].querySelectorAll('.brick-content-item[data-selected="true"]')]:[];
        const modelMatches=opened.length===1&&opened[0].querySelector('.brick-title-text')?.textContent.trim()===year+'年'&&selected.length===1&&selected[0].textContent.trim()===Number(month)+'月';
        results.push({...base,written:modelMatches,observed,error:modelMatches?null:'month-model-mismatch',action:'month-picker-reopened'});
      }catch{results.push(fail('month-widget-error'));}
      finally{
        // The observed SDK closes on outside mousedown, not Escape or icon toggle.
        if(ownsPanel&&panels().length){document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await pause(50);}
      }
    }
    return results;
  }
  return `(()=>{const resolveBaiduFormControl=${resolveBaiduFormControl.toString()};return (${execute.toString()})(${JSON.stringify(requests)});})()`;
}
async function executeBaiduMonths(workspace,requests) {
  // Hidden Electron views throttle page timers. Keep each SDK transaction below
  // the workspace's bounded script timeout instead of sending a whole resume.
  const results=[];
  for(const request of requests)results.push(...await workspace.run(buildBaiduMonthScript([request])));
  return results;
}
module.exports={planBaiduMonths,buildBaiduMonthScript,executeBaiduMonths};
