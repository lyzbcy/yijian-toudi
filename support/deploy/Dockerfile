FROM node:24-alpine
WORKDIR /opt/yijian-toudi-feedback-server
COPY version.json ./version.json
COPY support/feedback-server.cjs ./support/feedback-server.cjs
COPY electron/feedback.cjs electron/diagnostics.cjs electron/wecom-notify.cjs ./electron/
USER node
ENV YJT_FEEDBACK_DATA=/var/lib/yijian-feedback PORT=8096
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8096/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "support/feedback-server.cjs"]
