'use strict';
// Official entry points inspected 2026-10-22. Manual guidance is not automated
// resume saving or a verified application. No sensitive form data belongs here.
const manualCapabilities=()=>({jobs:'manual',login:'manual',resume:'manual',apply:'manual',status:'unsupported'});
const GUIDED_PLATFORMS=[
 {id:'bilibili',name:'哔哩哔哩',short:'B站',color:'#fb7299',portal:'https://jobs.bilibili.com/campus',tags:['互联网','游戏'],adapterStatus:'login-only',capabilities:manualCapabilities(),lastVerifiedAt:null,enabled:true,
  tracks:{social:{resume:'https://jobs.bilibili.com/social/resume',login:'https://jobs.bilibili.com/',jobs:'https://jobs.bilibili.com/social/positions'},campus:{resume:'https://jobs.bilibili.com/campus/resume',login:'https://jobs.bilibili.com/campus',jobs:'https://jobs.bilibili.com/campus/positions?type=3'}}},
 {id:'mihoyo',name:'米哈游',short:'米哈',color:'#5a8dee',logoUrl:'./assets/logos/mihoyo.svg',applyRule:{maxActive:1,cooldown:'30天',note:'米哈游 30 天内只能投递一个岗位'},portal:'https://jobs.mihoyo.com/#/campus',tags:['游戏','AI公司'],adapterStatus:'login-only',capabilities:manualCapabilities(),lastVerifiedAt:null,enabled:true,
  tracks:{social:{resume:'https://jobs.mihoyo.com/#/resume/edit',login:'https://jobs.mihoyo.com/',jobs:'https://jobs.mihoyo.com/#/position'},campus:{resume:'https://jobs.mihoyo.com/#/campus/resume/edit',login:'https://jobs.mihoyo.com/#/campus',jobs:'https://jobs.mihoyo.com/#/campus/position'}}},
 {id:'kuaishou',name:'快手',short:'快',color:'#ff4906',portal:'https://campus.kuaishou.cn/#/campus/index',tags:['互联网','AI公司'],adapterStatus:'login-only',capabilities:manualCapabilities(),lastVerifiedAt:null,enabled:true,resumeEntryKind:'portal',
  tracks:{social:{resume:'https://zhaopin.kuaishou.cn/',login:'https://zhaopin.kuaishou.cn/',jobs:'https://zhaopin.kuaishou.cn/'},campus:{resume:'https://campus.kuaishou.cn/#/campus/index',login:'https://campus.kuaishou.cn/#/campus/login',jobs:'https://campus.kuaishou.cn/#/campus/index'}}}
];
function guidedCompanies(){return GUIDED_PLATFORMS.map(({tracks,resumeEntryKind,...company})=>structuredClone(company))}
function guidedManifests(){return Object.fromEntries(GUIDED_PLATFORMS.map(p=>[p.id,{id:p.id,tracks:structuredClone(p.tracks),resumeEntryKind:p.resumeEntryKind||'resume',safety:{autoSaveProfile:false,autoSubmitApplication:false}}]))}
module.exports={GUIDED_PLATFORMS,guidedCompanies,guidedManifests};
