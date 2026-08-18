const PLATFORM_MANIFESTS = Object.freeze({
  tencent: {
    id: 'tencent',
    tracks: {
      social: {
        resume: 'https://careers.tencent.com/resume.html?operType=1',
        login: 'https://careers.tencent.com/login.html',
        jobs: 'https://careers.tencent.com/search.html'
      },
      campus: {
        // 2026-08-18 实测校准：resume.html 是查看态（1 个输入框），真实编辑页是 resumeedit.html（187 个输入框）
        resume: 'https://join.qq.com/resumeedit.html',
        login: 'https://join.qq.com/login.html',
        jobs: 'https://join.qq.com/post.html'
      }
    },
    trustedAuthHosts: ['open.weixin.qq.com', 'graph.qq.com', 'ssl.ptlogin2.qq.com', 'smartproxy.tencent.com'],
    safety: { autoSaveProfile: false, autoSubmitApplication: false }
  },
  bytedance: {
    id: 'bytedance',
    tracks: {
      social: {
        resume: 'https://jobs.bytedance.com/experienced/resume/edit',
        login: 'https://jobs.bytedance.com/experienced/login',
        jobs: 'https://jobs.bytedance.com/experienced/position'
      },
      campus: {
        resume: 'https://jobs.bytedance.com/campus/resume/edit',
        login: 'https://jobs.bytedance.com/campus/login',
        jobs: 'https://jobs.bytedance.com/campus/position'
      }
    },
    trustedAuthHosts: ['sso.bytedance.com', 'login.bytedance.com'],
    safety: { autoSaveProfile: false, autoSubmitApplication: false }
  },
  xiaomi: {
    id: 'xiaomi',
    tracks: {
      social: {
        // 2026-08-18 实测校准：旧 /user/profile/resume 已 404；真实编辑页是 /index/resume/edit（未登录会跳 /index/login）
        resume: 'https://xiaomi.jobs.f.mioffice.cn/index/resume/edit',
        login: 'https://xiaomi.jobs.f.mioffice.cn/index/login',
        jobs: 'https://xiaomi.jobs.f.mioffice.cn/index'
      },
      campus: {
        resume: 'https://xiaomi.jobs.f.mioffice.cn/campus/resume/edit',
        login: 'https://xiaomi.jobs.f.mioffice.cn/campus/login',
        jobs: 'https://xiaomi.jobs.f.mioffice.cn/campus'
      }
    },
    trustedAuthHosts: ['account.xiaomi.com'],
    safety: { autoSaveProfile: false, autoSubmitApplication: false }
  },
  jd: {
    id: 'jd',
    tracks: {
      social: {
        resume: 'https://zhaopin.jd.com/web/personal/resume',
        login: 'https://zhaopin.jd.com/web/login',
        jobs: 'https://zhaopin.jd.com/web/job/job_info_list/3'
      },
      campus: {
        resume: 'https://campus.jd.com/#/resume?type=present',
        login: 'https://zhaopin.jd.com/web/login',
        jobs: 'https://campus.jd.com/'
      }
    },
    trustedAuthHosts: ['passport.jd.com'],
    safety: { autoSaveProfile: false, autoSubmitApplication: false }
  },
  meituan: {
    id: 'meituan',
    tracks: {
      social: {
        // 2026-08-18 实测校准：旧 /web/personal/resume 已 404；社招编辑页复用 personal-center 路由，type=social
        resume: 'https://zhaopin.meituan.com/web/personal-center/resume-detail?type=social&mode=edit',
        login: 'https://zhaopin.meituan.com/web/login',
        jobs: 'https://zhaopin.meituan.com/web/social'
      },
      campus: {
        resume: 'https://zhaopin.meituan.com/web/personal-center/resume-detail?type=campus&mode=edit',
        login: 'https://zhaopin.meituan.com/web/login',
        jobs: 'https://zhaopin.meituan.com/web/campus'
      }
    },
    trustedAuthHosts: ['passport.meituan.com'],
    safety: { autoSaveProfile: false, autoSubmitApplication: false }
  },
  baidu: {
    id: 'baidu',
    tracks: {
      social: {
        // 2026-08-18 实测校准：/applicants/resume 是 API（返回 illegal-visit/need-login JSON）；
        // 真实个人中心是 /jobs/center（登录后可见资料与「编辑」弹窗入口）
        resume: 'https://talent.baidu.com/jobs/center',
        login: 'https://talent.baidu.com/jobs/login',
        jobs: 'https://talent.baidu.com/jobs/social-list'
      },
      campus: {
        resume: 'https://talent.baidu.com/jobs/resume/create',
        login: 'https://talent.baidu.com/jobs/login',
        jobs: 'https://talent.baidu.com/jobs/campus-list'
      }
    },
    trustedAuthHosts: ['passport.baidu.com'],
    safety: { autoSaveProfile: false, autoSubmitApplication: false }
  },
  alibaba: {
    id: 'alibaba',
    tracks: {
      social: {
        resume: 'https://talent.alibaba.com/personal/social-resume',
        login: 'https://talent.alibaba.com/',
        jobs: 'https://talent.alibaba.com/off-campus/position-list'
      },
      campus: {
        // 2026-08-18 实测校准：旧 personal-center 已 404（Whitelabel）；真实校招简历页是 /campus/personal/resume
        resume: 'https://campus-talent.alibaba.com/campus/personal/resume',
        login: 'https://campus-talent.alibaba.com/campus/index',
        jobs: 'https://campus-talent.alibaba.com/campus/position-list'
      }
    },
    trustedAuthHosts: ['login.taobao.com', 'passport.alibaba.com', 'mozi-login.alibaba-inc.com'],
    safety: { autoSaveProfile: false, autoSubmitApplication: false }
  },
  boss: {
    id: 'boss',
    tracks: {
      social: {
        resume: 'https://www.zhipin.com/web/geek/resume',
        login: 'https://www.zhipin.com/web/user/?ka=header-login',
        jobs: 'https://www.zhipin.com/web/geek/job'
      },
      campus: {
        resume: 'https://www.zhipin.com/web/geek/resume',
        login: 'https://www.zhipin.com/web/user/?ka=header-login',
        jobs: 'https://www.zhipin.com/school/'
      }
    },
    safety: {
      autoSaveProfile: false,
      autoSubmitApplication: false,
      thirdPartyAutomationAllowed: false,
      restriction: 'BOSS 直聘用户协议禁止未经许可使用第三方软件或爬虫自动访问平台'
    }
  }
});

function normalizeTrack(recruitType) {
  if (recruitType === 'all') throw new Error('“全部都要”必须先拆分为社招和校招两个简历轨道');
  return ['campus', 'summer-intern', 'daily-intern'].includes(recruitType) ? 'campus' : 'social';
}

function resolvePlatformUrl(companyId, recruitType, purpose) {
  const manifest = PLATFORM_MANIFESTS[companyId];
  if (!manifest) throw new Error(`未声明的平台：${companyId}`);
  const track = normalizeTrack(recruitType);
  const value = manifest.tracks?.[track]?.[purpose];
  if (!value) throw new Error(`${companyId} ${track} 未声明 ${purpose} 入口`);
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error(`${companyId} ${purpose} 入口必须使用 https`);
  return value;
}

function normalizedObserved(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).sort();
  if (typeof value === 'boolean') return value;
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function verifyObservedValue(expected, observed) {
  return JSON.stringify(normalizedObserved(expected)) === JSON.stringify(normalizedObserved(observed));
}

module.exports = {
  PLATFORM_MANIFESTS,
  normalizeTrack,
  resolvePlatformUrl,
  verifyObservedValue
};
