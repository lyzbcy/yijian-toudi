const BACKUP_FORMAT = 'yijian-toudi-backup';
const BACKUP_FORMAT_VERSION = 1;

function createBackup(state, appVersion) {
  const data = structuredClone(state);
  delete data.idempotency;
  delete data.audit;
  if (data.settings) {
    delete data.settings.apiToken;
    if (data.settings.email) {delete data.settings.email.encryptedCode;for(const a of data.settings.email.accounts||[])delete a.encryptedCode;}
  }
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion,
    createdAt: new Date().toISOString(),
    data
  };
}

function requireBackup(backup) {
  if (
    !backup ||
    backup.format !== BACKUP_FORMAT ||
    backup.formatVersion !== BACKUP_FORMAT_VERSION ||
    !backup.data ||
    typeof backup.data !== 'object'
  ) {
    throw new Error('备份格式不正确或版本不受支持');
  }
  if (!backup.data.resume || !backup.data.settings) {
    throw new Error('备份缺少简历或设置数据');
  }
}

function restoreBackup(currentState, backup) {
  requireBackup(backup);
  const current = structuredClone(currentState);
  const source = structuredClone(backup.data);
  const sourceEmail = source.settings?.email || {};
  const currentEmail = current.settings?.email || {};
  const sameEmail = !sourceEmail.address ||
    !currentEmail.address ||
    sourceEmail.address === currentEmail.address;

  return {
    ...current,
    meta: {
      ...current.meta,
      privacyAcceptedAt: source.meta?.privacyAcceptedAt ||
        current.meta?.privacyAcceptedAt ||
        null
    },
    jobs: Array.isArray(source.jobs) ? source.jobs : current.jobs,
    messages: Array.isArray(source.messages) ? source.messages : current.messages,
    resume: source.resume,
    cart: Array.isArray(source.cart) ? source.cart : [],
    applied: Array.isArray(source.applied) ? source.applied : [],
    careerApplications: Array.isArray(source.careerApplications) ? source.careerApplications : (current.careerApplications || []),
    careerMailReview:Array.isArray(source.careerMailReview)?source.careerMailReview:[],
    tasks: Array.isArray(source.tasks) ? source.tasks : current.tasks,
    audit: current.audit || [],
    idempotency: current.idempotency || {},
    settings: {
      ...current.settings,
      ...source.settings,
      apiToken: current.settings.apiToken,
      email: {
        ...currentEmail,
        ...sourceEmail,
        accounts:(sourceEmail.accounts||currentEmail.accounts||[]).map(a=>{const match=(currentEmail.accounts||[]).find(c=>c.address===a.address&&c.method===a.method&&c.accountId===a.accountId&&c.profileId===a.profileId);return {...a,encryptedCode:match?.encryptedCode||'',connected:match?.connected===true};}),
        encryptedCode: sameEmail ? currentEmail.encryptedCode : '',
        connected: sameEmail
          ? Boolean(currentEmail.connected && currentEmail.encryptedCode)
          : false
      }
    }
  };
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  createBackup,
  restoreBackup
};
