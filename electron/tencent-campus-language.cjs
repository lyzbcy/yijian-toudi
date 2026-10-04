const {tencentCampusContext}=require('./tencent-campus-context.cjs');
function splitTencentLanguages(value){const tokens=Array.isArray(value)?value:String(value||'').split(/[,，、;；\n]+/);return [...new Set(tokens.map(v=>String(v).trim()).filter(Boolean))];}
function buildTencentLanguageScript(values){
  async function perform(ctx,desired){
    const base={key:'skills.devLanguages',expected:[...desired].sort().join('、')},pause=ms=>new Promise(r=>setTimeout(r,ms));
    const row=ctx.resolveRow({section:'语言能力',groupNumber:null,label:'开发语言'}),selects=row?[...row.querySelectorAll('.el-select')]:[],select=selects.length===1?selects[0]:null;
    if(!ctx.valid()||!select||!desired.length||desired.length>30)return {...base,written:false,error:'language-select-unavailable'};
    const menu=ctx.ownedMenu(select);if(!menu)return {...base,written:false,error:'owned-language-menu-unavailable'};
    const other=[...document.querySelectorAll('.el-select-dropdown,.el-picker-panel,.el-cascader__dropdown')].filter(e=>e!==menu&&ctx.visible(e));if(other.length)return {...base,written:false,error:'another-popup-open'};
    const inputs=[...select.querySelectorAll('input.el-input__inner')].filter(e=>!e.disabled);if(inputs.length!==1)return {...base,written:false,error:'language-toggle-unavailable'};
    const options=()=>[...menu.querySelectorAll('.el-select-dropdown__item')],selected=()=>options().filter(e=>e.classList.contains('selected')).map(ctx.text),exact=value=>options().filter(e=>ctx.text(e)===value),disabled=e=>e.classList.contains('is-disabled')||e.getAttribute('aria-disabled')==='true';
    const previous=selected(),target=new Set(desired);let changed=false;
    const close=()=>{const input=select.querySelector('.el-select__input')||inputs[0];input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));};
    const restore=async()=>{for(const value of new Set([...selected(),...previous])){const es=exact(value);if(es.length===1&&!disabled(es[0])&&es[0].classList.contains('selected')!==previous.includes(value)){es[0].click();await pause(50);}}};
    try{
      if(!ctx.visible(menu)){inputs[0].click();for(let i=0;i<20&&!ctx.visible(menu);i++)await pause(50);}if(!ctx.visible(menu))return {...base,written:false,error:'language-menu-not-open'};
      const changes=[...new Set([...previous,...desired])].filter(v=>previous.includes(v)!==target.has(v));
      // Validate every candidate before the first selection or removal.
      for(const value of new Set([...desired,...changes])){const es=exact(value);if(es.length!==1||disabled(es[0]))return {...base,written:false,error:es.length>1?'language-option-ambiguous':es.length?'language-option-disabled':'language-option-missing'};}
      for(const value of changes){const es=exact(value);if(es.length!==1||disabled(es[0]))throw Error('language-option-changed');changed=true;es[0].click();await pause(100);}
      await pause(300);const observed=selected().sort().join('、');if(observed!==base.expected){await restore();return {...base,written:false,error:'language-model-mismatch-restored',observed:selected().sort().join('、')};}
      return {...base,written:true,observed,locator:{section:'语言能力',groupNumber:null,label:'开发语言',widget:'multiselect'}};
    }catch{if(changed)await restore();return {...base,written:false,error:'language-selection-failed-restored'};}
    finally{close();}
  }
  return `(()=>{const ctx=(${tencentCampusContext.toString()})();return (${perform.toString()})(ctx,${JSON.stringify(values)});})()`;
}
function buildTencentLanguageReadbackScript(result){return `(()=>{const ctx=(${tencentCampusContext.toString()})();const item=${JSON.stringify(result)},r=ctx.resolveRow(item.locator||{}),ss=r?[...r.querySelectorAll('.el-select')]:[],menu=ss.length===1?ctx.ownedMenu(ss[0]):null;const retained=ctx.valid()&&ctx.visible(r)&&!!menu;return {...item,retained,error:retained?item.error:'final-language-menu-unavailable',observed:retained?[...menu.querySelectorAll('.el-select-dropdown__item.selected')].map(ctx.text).sort().join('、'):''};})()`;}
module.exports={splitTencentLanguages,buildTencentLanguageScript,buildTencentLanguageReadbackScript};
