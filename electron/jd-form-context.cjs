// Observed JD campus DOM: semantic field labels and enclosing numbered groups.
// Functions are serialized into the page; no React internals or global indexes.
function getJdFormContext(control) {
  if(typeof location==='undefined'||location.origin!=='https://campus.jd.com')return null;
  const row=control.closest('[class*="fieldItem___"]');
  const section=row?.closest('[class*="gridContainer___"][id]');
  const group=row?.closest('[class*="formGroupItem___"]');
  const labelNode=row&&[...row.children].find(e=>String(e.className).includes('filedName___'));
  const label=(labelNode?.textContent||'').replace(/[\s*＊:：]/g,'');
  if(!section||!group||!label)return null;
  const groups=[...section.querySelectorAll('[class*="formGroupItem___"]')].filter(g=>g.closest('[class*="gridContainer___"][id]')===section);
  const controls=[...row.querySelectorAll('input,textarea,select')].filter(c=>c.type!=='hidden'&&c.type!=='file');
  const ordinal=controls.indexOf(control);if(ordinal<0)return null;
  return{sectionId:section.id,groupNumber:groups.indexOf(group)+1,label,ordinal,tag:control.tagName,type:control.type,placeholder:control.placeholder||''};
}
function resolveJdFormControl(locator) {
  if(typeof location==='undefined'||location.origin!=='https://campus.jd.com')return null;
  const sections=[...document.querySelectorAll('[class*="gridContainer___"][id]')].filter(s=>s.id===locator.sectionId);
  if(sections.length!==1)return null;
  const section=sections[0],groups=[...section.querySelectorAll('[class*="formGroupItem___"]')].filter(g=>g.closest('[class*="gridContainer___"][id]')===section);
  const group=groups[locator.groupNumber-1];if(!group)return null;
  const rows=[...group.querySelectorAll('[class*="fieldItem___"]')].filter(row=>{
    const labelNode=[...row.children].find(e=>String(e.className).includes('filedName___'));
    return (labelNode?.textContent||'').replace(/[\s*＊:：]/g,'')===locator.label;
  });
  if(rows.length!==1)return null;
  const controls=[...rows[0].querySelectorAll('input,textarea,select')].filter(c=>c.type!=='hidden'&&c.type!=='file');
  const c=controls[locator.ordinal];
  return c&&!c.disabled&&!c.readOnly&&c.tagName===locator.tag&&c.type===locator.type&&(c.placeholder||'')===locator.placeholder?c:null;
}
function buildEnsureJdGroupsScript(requests) {
  async function ensure(requests) {
    if(location.origin!=='https://campus.jd.com'||!location.hash.startsWith('#/resume')||!document.getElementById('info'))return{skipped:true};
    const result=[];
    for(const {sectionId,count}of requests){
      if(!['edu','experience','program'].includes(sectionId)||!Number.isSafeInteger(count)||count<0||count>10){result.push({sectionId,error:'invalid-count'});continue;}
      const section=document.getElementById(sectionId);if(!section){result.push({sectionId,error:'section-missing'});continue;}
      const groups=()=>[...section.querySelectorAll('[class*="formGroupItem___"]')].filter(g=>g.closest('[class*="gridContainer___"][id]')===section);
      let error=null;
      while(groups().length<count){
        const buttons=[...section.querySelectorAll('a[role="button"],button')].filter(b=>/^\+?添加$/.test(b.textContent.replace(/\s+/g,''))&&b.getClientRects().length&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');
        if(buttons.length!==1){error='add-action-ambiguous-or-missing';break;}
        const before=groups().length;buttons[0].click();const until=Date.now()+2500;
        while(groups().length===before&&Date.now()<until)await new Promise(r=>setTimeout(r,50));
        if(groups().length!==before+1){error='group-not-added';break;}
      }
      result.push({sectionId,count:groups().length,requested:count,error});
    }
    return{skipped:false,sections:result};
  }
  return `(${ensure.toString()})(${JSON.stringify(requests)})`;
}
module.exports={getJdFormContext,resolveJdFormControl,buildEnsureJdGroupsScript};
