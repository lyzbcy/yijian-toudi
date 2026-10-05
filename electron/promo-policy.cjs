const FIFTEEN_DAYS=15*24*60*60*1000;
function shouldPrompt(meta,now=Date.now()){
 return Number(meta?.fillCompletedCount||0)>=3&&now>=Number(meta?.starPromptDismissedUntil||0);
}
function migratePromotion(meta,now=Date.now()){
 const next={...meta};if(next.starPromptDone&&next.starPromptDismissedUntil===undefined)next.starPromptDismissedUntil=now+FIFTEEN_DAYS;
 next.starPromptDue=shouldPrompt(next,now);return next;
}
function dismissPromotion(meta,now=Date.now()){
 return{...meta,starPromptDue:false,starPromptDone:true,starPromptDismissedAt:now,starPromptDismissedUntil:now+FIFTEEN_DAYS};
}
module.exports={FIFTEEN_DAYS,shouldPrompt,migratePromotion,dismissPromotion};
