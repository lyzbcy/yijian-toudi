// Only exact Edit/Add actions. Semantics come from the table caption, not .name.
function alibabaContext() {
  const visible=e=>Boolean(e?.getClientRects().length);
  const title=c=>c.querySelector('[class*="FormCard--formCardTitle--"]')?.textContent.trim();
  const cards=t=>[...document.querySelectorAll('[class*="FormCard--formCard--"]')].filter(c=>title(c)===t&&visible(c));
  const controls=c=>[...c.querySelectorAll('input,textarea,select')].filter(e=>!e.disabled&&!['hidden','button','submit','file'].includes(e.type));
  const label=e=>(e.closest('.next-form-item')?.querySelector('.next-form-item-label')?.textContent||'').replace(/^[*＊\s]+|[*＊\s：:]+$/g,'').trim();
  const widget=e=>e.readOnly||e.closest('.next-select,.next-range-picker,.next-date-picker,.next-date-picker2,.next-time-picker')?'widget':['text','email','tel','number','textarea'].includes(e.type)?'text':'unsupported';
  const descriptor=e=>({name:e.name||'',label:label(e),type:e.type,widget:widget(e)});
  const buttons=(c,t)=>[...c.querySelectorAll('button,[role=button]')].filter(e=>visible(e)&&e.textContent.trim()===t);
  const table=(c,add)=>{const bs=buttons(c,add);return bs.length===1?bs[0].closest('.deep-table-form-field'):null;};
  const rows=t=>{const result=new Set();for(const e of t?controls(t):[]){const m=e.name?.match(/^(tfitem_\d+)\./);if(m)result.add(m[1]);}return [...result];};
  const resolve=locator=>{
    const cs=cards(locator.card);if(cs.length!==1)return null;const c=cs[0];let candidates;
    if(locator.add&&locator.row){const t=table(c,locator.add);if(!t)return null;candidates=controls(t).filter(e=>e.name===locator.name&&e.name.startsWith(locator.row+'.'));}
    else if(locator.name)candidates=controls(c).filter(e=>e.name===locator.name);
    else candidates=controls(c).filter(e=>!e.name&&label(e)===locator.label&&e.type===locator.type&&widget(e)===locator.widget);
    return candidates.length===1&&JSON.stringify(descriptor(candidates[0]))===JSON.stringify({name:locator.name,label:locator.label,type:locator.type,widget:locator.widget})?candidates[0]:null;
  };
  return {visible,cards,controls,label,widget,descriptor,buttons,table,rows,resolve};
}
function script(fn,arg){return `(()=>{const ctx=(${alibabaContext.toString()})();return (${fn.toString()})(ctx,${JSON.stringify(arg)});})()`;}
function buildAlibabaCardScript(card){return script((ctx,card)=>{const cs=ctx.cards(card);if(cs.length!==1)return {ok:false,reason:'card-missing-or-ambiguous'};const c=cs[0];if(ctx.buttons(c,'保存').length===1)return {ok:true,alreadyEditing:true};const edits=ctx.buttons(c,'编辑');if(edits.length!==1)return {ok:false,reason:'edit-missing-or-ambiguous'};edits[0].click();return {ok:true,opened:true};},card);}
function buildAlibabaInspectScript(card){return script((ctx,card)=>{
  const cs=ctx.cards(card);if(cs.length!==1)return {ok:false,fields:[],groups:[]};const c=cs[0];
  const specs=[['education','添加教育情况'],['experience','添加更多实习经历'],['projects','添加更多项目经历']];
  const groups=specs.map(([kind,add])=>({kind,add,rows:ctx.rows(ctx.table(c,add)),recognized:Boolean(ctx.table(c,add))}));
  const fields=ctx.controls(c).map((e,index)=>{const d=ctx.descriptor(e),g=groups.find(g=>ctx.table(c,g.add)?.contains(e)),row=e.name?.match(/^(tfitem_\d+)\./)?.[1];return {index,...d,readOnly:d.widget!=='text',value:e.value,locator:{card,...d,...(g&&row?{add:g.add,row}:{})}};});
  return {ok:true,editing:ctx.buttons(c,'保存').length===1,fields,groups};
},card);}
function buildAlibabaAddScript(card,add,expectedRows){return script((ctx,arg)=>{const cs=ctx.cards(arg.card);if(cs.length!==1)return false;const c=cs[0],t=ctx.table(c,arg.add);if(!t||ctx.rows(t).length!==arg.expectedRows)return false;const bs=ctx.buttons(c,arg.add);if(bs.length!==1||bs[0].disabled||bs[0].getAttribute('aria-disabled')==='true')return false;bs[0].click();return true;},{card,add,expectedRows});}
function buildAlibabaWriteScript(writes){return script((ctx,writes)=>writes.map(item=>{
  const e=ctx.resolve(item.locator);if(!e||ctx.widget(e)!=='text')return {key:item.key,written:false,error:'control-missing-or-unsupported',locator:item.locator,expected:item.value};
  try{const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(!setter)throw Error('setter-missing');e.focus();setter.call(e,String(item.value));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.blur();return {key:item.key,written:true,locator:item.locator,expected:String(item.value),observed:e.value};}catch{return {key:item.key,written:false,error:'write-failed',locator:item.locator,expected:item.value};}
}),writes);}
function buildAlibabaReadbackScript(execution){return script((ctx,items)=>items.map(item=>{const e=ctx.resolve(item.locator);return {...item,observed:e?.value??'',retained:Boolean(e&&ctx.visible(e)&&ctx.widget(e)==='text')};}),execution);}
module.exports={buildAlibabaCardScript,buildAlibabaInspectScript,buildAlibabaAddScript,buildAlibabaWriteScript,buildAlibabaReadbackScript};
