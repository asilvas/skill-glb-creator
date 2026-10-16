import { existsSync,lstatSync,mkdirSync,readdirSync,realpathSync,rmdirSync,unlinkSync,writeFileSync,readFileSync } from 'node:fs';
import { isAbsolute,relative,resolve } from 'node:path';
import { setPriority,constants } from 'node:os';
import { TMP } from './paths';
const DAY=86400000;
function inside(root:string,path:string){const r=relative(root,path);return r!==''&&r!=='..'&&!r.startsWith('..\\')&&!r.startsWith('../')&&!isAbsolute(r);}
function safeRoot(root:string){
  const p=resolve(root);mkdirSync(TMP,{recursive:true});
  if(p!==TMP&&!inside(TMP,p))throw Error('Cleanup is confined to tmp');
  // Reject a symlink in any parent segment, including a junction used as tmp.
  if(realpathSync(TMP).toLowerCase()!==resolve(TMP).toLowerCase())throw Error('Scratch root must not be a symlink');
  let parent=TMP;for(const part of relative(TMP,p).split(/[\\/]/).filter(Boolean)){parent=resolve(parent,part);if(existsSync(parent)&&lstatSync(parent).isSymbolicLink())throw Error('Cleanup parents must not be symlinks');}
  if(existsSync(p)&&realpathSync(p).toLowerCase()!==p.toLowerCase())throw Error('Cleanup root must not be a symlink');
  return p;
}
export function sweep(root=TMP,{apply=false,olderDays=7,now=Date.now()}={}){
  if(!Number.isFinite(olderDays)||olderDays<1)throw Error('older-days must be at least 1');
  root=safeRoot(root);const removed:string[]=[],skipped:string[]=[],cutoff=now-olderDays*DAY;
  if(!existsSync(root))return {removed,skipped};
  function visit(dir:string){
    for(const e of readdirSync(dir,{withFileTypes:true})){
      const p=resolve(dir,e.name);if(!inside(root,p))throw Error('Cleanup escaped scratch root');
      if(dir===root&&['.cleanup-lock','.cleanup-state.json'].includes(e.name))continue;
      let s;try{s=lstatSync(p);}catch(e){if((e as any).code==='ENOENT')continue;throw e;}
      if(s.isSymbolicLink()){skipped.push(p);continue;}
      if(s.isDirectory()){
        visit(p);
        // A stale directory may contain recent files. Only prune empty directories.
        if(s.mtimeMs<cutoff&&readdirSync(p).length===0){removed.push(p);if(apply)rmdirSync(p);}
      }else if(s.isFile()&&s.mtimeMs<cutoff){
        if(e.name==='preview-server.json'){try{const r=JSON.parse(readFileSync(p,'utf8'));process.kill(r.pid,0);skipped.push(p);continue;}catch{}}
        removed.push(p);if(apply)unlinkSync(p);
      }
    }
  }
  visit(root);return {removed,skipped};
}
/** Dispatch at most daily, without waiting for traversal. Child outlives the caller. */
export function scheduleCleanup({root=TMP,force=false}={}){
  if(process.env.GLB_CREATOR_CLEANUP==='off')return;
  root=safeRoot(root);mkdirSync(root,{recursive:true});const state=resolve(root,'.cleanup-state.json'),lock=resolve(root,'.cleanup-lock');
  if(!force&&existsSync(state)){try{if(Date.now()-JSON.parse(readFileSync(state,'utf8')).finished<DAY)return;}catch{}}
  if(existsSync(lock)){if(Date.now()-lstatSync(lock).mtimeMs<3600000)return;try{rmdirSync(lock);}catch{return;}}
  try{mkdirSync(lock);}catch{return;}
  try{
    const child=Bun.spawn([process.execPath,resolve(import.meta.dir,'clean.ts'),'--worker',`--root=${root}`],{cwd:resolve(import.meta.dir,'..'),detached:true,windowsHide:true,stdin:'ignore',stdout:'ignore',stderr:'ignore',env:process.env});
    child.unref();return child.pid;
  }catch(e){rmdirSync(lock);throw e;}
}
export async function cleanupWorker(root:string){
  root=safeRoot(root);try{
    try{setPriority(0,constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
    // Bounded delay is used only by the detached-process behavioral test.
    const delay=Math.min(1000,Math.max(0,Number(process.env.GLB_CREATOR_CLEANUP_TEST_DELAY_MS)||0));if(delay)await Bun.sleep(delay);
    const result=sweep(root,{apply:true});writeFileSync(resolve(root,'.cleanup-state.json'),JSON.stringify({finished:Date.now(),olderDays:7,...result}));
  }finally{try{rmdirSync(resolve(root,'.cleanup-lock'));}catch{}}
}
