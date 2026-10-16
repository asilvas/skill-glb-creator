import { test,expect } from 'bun:test';
import { mkdirSync,writeFileSync,utimesSync,existsSync,symlinkSync,rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { TMP } from '../scripts/paths';
import { sweep } from '../scripts/cleanup';
const stale=new Date(Date.now()-9*86400000);
test('cleanup expires files individually, retains recent children, skips links, and confines paths',()=>{
  const root=resolve(TMP,`cleanup-test-${crypto.randomUUID()}`),outside=resolve(TMP,`cleanup-target-${crypto.randomUUID()}`);
  mkdirSync(resolve(root,'nested'),{recursive:true});mkdirSync(outside);writeFileSync(resolve(outside,'keep'),'protected');
  writeFileSync(resolve(root,'nested','old'),'old');utimesSync(resolve(root,'nested','old'),stale,stale);
  writeFileSync(resolve(root,'nested','recent'),'new');utimesSync(resolve(root,'nested'),stale,stale);
  symlinkSync(outside,resolve(root,'link'),'junction');
  try{
    expect(sweep(root).removed).toContain(resolve(root,'nested','old'));expect(existsSync(resolve(root,'nested','old'))).toBe(true);
    const result=sweep(root,{apply:true});expect(result.skipped).toContain(resolve(root,'link'));expect(existsSync(resolve(root,'nested','old'))).toBe(false);expect(existsSync(resolve(root,'nested','recent'))).toBe(true);expect(existsSync(resolve(outside,'keep'))).toBe(true);
    expect(()=>sweep(resolve(TMP,'..','demo'),{apply:true})).toThrow();expect(()=>sweep(resolve(root,'link'),{apply:true})).toThrow();expect(()=>sweep(resolve(root,'link','missing'),{apply:true})).toThrow();
  }finally{rmSync(root,{recursive:true});rmSync(outside,{recursive:true});}
});
test('background cleanup survives its launcher and writes a seven-day receipt',async()=>{
  const root=resolve(TMP,`cleanup-detached-${crypto.randomUUID()}`);mkdirSync(root,{recursive:true});writeFileSync(resolve(root,'old'),'old');utimesSync(resolve(root,'old'),stale,stale);
  const source=`import {scheduleCleanup} from ${JSON.stringify(resolve(import.meta.dir,'../scripts/cleanup.ts'))}; console.log(scheduleCleanup({root:${JSON.stringify(root)},force:true}));`;
  const parent=Bun.spawn([process.execPath,'-e',source],{stdout:'pipe',stderr:'pipe',windowsHide:true,env:{...process.env,GLB_CREATOR_CLEANUP:'on',GLB_CREATOR_CLEANUP_TEST_DELAY_MS:'750'}});
  const [out,err,code]=await Promise.all([new Response(parent.stdout).text(),new Response(parent.stderr).text(),parent.exited]);
  expect(code,err).toBe(0);expect(Number(out.trim())).toBeGreaterThan(0);expect(existsSync(resolve(root,'old'))).toBe(true);
  try{
    for(let i=0;i<100&&!existsSync(resolve(root,'.cleanup-state.json'));i++)await Bun.sleep(50);
    const state=await Bun.file(resolve(root,'.cleanup-state.json')).json();expect(state.olderDays).toBe(7);expect(existsSync(resolve(root,'old'))).toBe(false);expect(existsSync(resolve(root,'.cleanup-lock'))).toBe(false);
  }finally{rmSync(root,{recursive:true});}
},10000);
