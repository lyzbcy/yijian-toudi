const test=require('node:test'),assert=require('node:assert/strict');
const {planAlibabaCard}=require('../electron/adapters/alibaba-fill.cjs');
const field=(name,label,type='text',readOnly=false)=>({name,label,type,readOnly,locator:{name,label,type,widget:readOnly?'widget':'text'}});
const items=values=>Object.entries(values).map(([key,value])=>({key,value}));
test('project .name stays manual organization; full facts have explicit description mapping',()=>{
 const fields=[field('tfitem_3.name','公司或组织名称'),field('tfitem_3.responsibility','职位或职责'),field('tfitem_3.description','工作描述','textarea'),field('tfitem_99.name','公司或组织名称')];
 const result=planAlibabaCard(items({'experience.0.company':'工作单位','projects.0.name':'项目标题','projects.0.client':'服务客户','projects.0.role':'项目职责','projects.0.contribution':'贡献','projects.0.outcome':'成果','projects.0.link':'https://example.invalid/p'}),{fields,groups:[{kind:'projects',recognized:true,rows:['tfitem_3']}]},'实习/项目经历');
 assert.deepEqual(result.writes.map(w=>w.locator.name),['tfitem_3.responsibility','tfitem_3.description']);assert.equal(result.writes[1].value,'项目名称：项目标题\n客户/服务客户：服务客户\n个人贡献：贡献\n项目成果：成果\n项目链接：https://example.invalid/p');assert.equal(result.represented.has('experience.0.company'),false);assert.equal(result.mappings[1].representation,'labeled-project-description');
});
test('unrecognized table and duplicate field identity refuse project writes',()=>{
 const plan=items({'projects.0.name':'项目标题'}),fields=[field('tfitem_3.description','工作描述','textarea')];assert.equal(planAlibabaCard(plan,{fields,groups:[]},'实习/项目经历').writes.length,0);
 assert.equal(planAlibabaCard(plan,{fields:[...fields,...fields],groups:[{kind:'projects',recognized:true,rows:['tfitem_3']}]},'实习/项目经历').writes.length,0);
});
test('school selection search and incomplete GPA scale are never generic text writes',()=>{
 const fields=[field('tfitem_1.school','学校全称','text',true),field('tfitem_1.gpaScore','GPA成绩')],groups=[{kind:'education',recognized:true,rows:['tfitem_1']}];
 assert.equal(planAlibabaCard(items({'education.0.school':'学校','education.0.gpa':'3.8'}),{fields,groups},'教育情况').writes.length,0);
 const result=planAlibabaCard(items({'education.0.gpa':'3.8','education.0.gpaBase':'4'}),{fields,groups},'教育情况');assert.equal(result.writes[0].value,'3.8/4');assert.deepEqual(result.mappings[0].sourceKeys,['education.0.gpa','education.0.gpaBase']);
});
test('ID number needs matching ID type and conflicting legacy fact refuses write',()=>{
 const inspection={fields:[field('','身份证号')]};
 assert.equal(planAlibabaCard(items({'basic.idNumber':'passport-example','basic.idType':'护照'}),inspection,'个人信息').writes.length,0);
 assert.equal(planAlibabaCard(items({'basic.idNumber':'number-example','basic.idType':'身份证','basic.idCard':'different-example'}),inspection,'个人信息').writes.length,0);
 assert.equal(planAlibabaCard(items({'basic.idNumber':'number-example','basic.idType':'身份证'}),inspection,'个人信息').writes.length,1);
});
