// Socket inactivity timeout alone does not bound DNS/TLS or trickling responses.
function guardRequest(request, timeoutMs = 30000) {
  const timer = setTimeout(() => request.destroy(new Error('岗位请求超过总时限，请稍后重试')), timeoutMs);
  timer.unref();
  request.once('close', () => clearTimeout(timer));
}

function guardResponse(response, reject) {
  response.once('error', reject);
  response.once('aborted', () => reject(new Error('岗位响应中途断开，已保留原有数据')));
}

module.exports = { guardRequest, guardResponse };
