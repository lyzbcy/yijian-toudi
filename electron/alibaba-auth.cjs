function alibabaAuthFailure(text){return /重定向循环|ERR_TOO_MANY_REDIRECTS|redirect(?:ion)?\s+(?:loop|cycle)|应用暂时无法访问/i.test(String(text||'').slice(0,8000))?'auth-redirect-loop':null;}
const ALIBABA_AUTH_PROBE=`(${alibabaAuthFailure.toString()})(document.body?.innerText||'')`;
const AUTH_LOOP_MESSAGE='阿里官网登录出现重定向循环或应用不可用，已暂停本平台；不会自动重试、清除Cookie或更改登录态。请从官方校招首页核对登录后继续，其他平台可独立处理';
module.exports={alibabaAuthFailure,ALIBABA_AUTH_PROBE,AUTH_LOOP_MESSAGE};
