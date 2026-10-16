import { TMP } from './paths';
import { cleanupWorker,scheduleCleanup,sweep } from './cleanup';
const root=process.argv.find(a=>a.startsWith('--root='))?.slice(7)??TMP;
if(process.argv.includes('--worker'))await cleanupWorker(root);
else if(process.argv.includes('--background'))console.log(JSON.stringify({pid:scheduleCleanup({root,force:true})}));
else {
  const olderDays=Number(process.argv.find(a=>a.startsWith('--older-days='))?.slice(13)??7),apply=process.argv.includes('--apply');
  const result=sweep(root,{apply,olderDays});console.log(JSON.stringify({apply,olderDays,...result},null,2));
}
