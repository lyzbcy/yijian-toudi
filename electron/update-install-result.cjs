'use strict';
const fs=require('node:fs/promises'),crypto=require('node:crypto');
async function writeInstallResult(file,result){
 const data=JSON.stringify(result,null,2),temporary=file+'.tmp-'+process.pid+'-'+crypto.randomBytes(8).toString('hex');
 try{await fs.writeFile(temporary,data,{flag:'wx'});await fs.rename(temporary,file);}catch(error){await fs.rm(temporary,{force:true}).catch(()=>{});throw error;}
}
module.exports={writeInstallResult};
