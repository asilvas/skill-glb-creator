import {test,expect} from 'bun:test';
import {mkdtempSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {Asset} from '../scripts/geometry';
import {generateVariants} from '../scripts/variants';
import {adaptiveProfile,selectOptimized,searchQualityVariants,type SearchCandidate} from '../scripts/optimize-search';
const row=(bytes:number,q:number,sequence=0):SearchCandidate=>({profile:{...adaptiveProfile(),id:'fixture-'+sequence},bytes,quality:{valid:true,retention:q},sequence});

test('auto selection measures every fitting candidate and retains best quality, not first fit',()=>{
 const a=row(80,.8,1),b=row(90,.97,2),c=row(60,.6,3),d=row(85,.97,4);
 expect(selectOptimized([a,b,c,d],100).candidate).toBe(d);
 expect(selectOptimized([a,b,c,d],70).candidate).toBe(c);
 expect(selectOptimized([a,b,c,d],70).qualityAccepted).toBe(true);
 expect(selectOptimized([a,b,c,d],70,.9).met).toBe(false);
 expect(selectOptimized([a,b,c,d],70,.9).candidate).toBe(d);
});
test('default optimization minimizes bytes at90% retention, with explicit missing and blank observations excluded',()=>{
 const master=row(1000,1),tiny=row(100,.89,1),accepted=row(120,.91,2),best=row(110,.9,3),blank={...row(5,1,4),quality:{valid:false,retention:1,reason:'blank'}},nan={...row(3,1,5),quality:{valid:true,retention:NaN}},zero={...row(0,1,6)};
 const selected=selectOptimized([master,tiny,accepted,best,blank,nan,zero],null);
 expect(selected.candidate).toBe(best);expect(selected.budgetMet).toBeNull();expect(selected.qualityAccepted).toBe(true);
 expect(selectOptimized([master,tiny],null).candidate).toBe(master);
 expect(()=>selectOptimized([blank,nan,zero],null)).toThrow('valid rendered');
});
test('adaptive search explores independent methods, hybrids and constraint crossings under bounded evaluation',async()=>{
 const master={...row(10000,1),profile:{...adaptiveProfile(1,1,100,false),id:'master'}};
 const seen:any[]=[];
 const result=await searchQualityVariants(master,async p=>{
  seen.push(p);const g=1-p.ratio,t=1-p.textureScale,c=(100-p.colorQuality)/100;
  // Deliberately nonmonotonic interaction: less geometry can score better than
  // one intermediate combination. The search must still select by observations.
  const retention=Math.max(0,1-.08*g-.2*t-.1*c-(g>.4&&t>.4?.07:0)+(g>.7&&t<.1?.01:0));
  return {bytes:Math.round(200+5000*p.ratio+3000*p.textureScale+1000*p.colorQuality/100),quality:{valid:true,retention}};
 },{maxEvaluations:16});
 expect(result.evaluations).toBe(16);expect(seen.some(p=>p.ratio<1&&p.textureScale<1)).toBe(true);expect(seen.some(p=>p.colorQuality<100)).toBe(true);
 const passing=result.candidates.filter(c=>c.quality.retention!>=.9);expect(result.selection[0].candidate.bytes).toBe(Math.min(...passing.map(c=>c.bytes)));expect(result.selection[0].qualityAccepted).toBe(true);
 expect(result.candidates.filter(c=>c.proposalReason?.includes('crossing')||c.proposalReason?.includes('rejected')).length).toBeGreaterThan(0);
});

test('a local texture quality crossing cannot starve smaller geometry branches',async()=>{
 const master={...row(79753396,1),profile:{...adaptiveProfile(1,1,100,false),id:'master'}};
 const seen:any[]=[];
 const result=await searchQualityVariants(master,async p=>{
  seen.push(p);
  // Compact-master-shaped response: texture resolution fails sharply below
  // about0.14, whereas geometry still has useful headroom. The old search
  // repeatedly bisected the texture crossing and never tested geometry0.25.
  const geometryLoss=.0107*Math.log2(1/p.ratio);
  const textureLoss=.0015*(1/p.textureScale**2-1);
  const retention=Math.max(0,1-geometryLoss-textureLoss-.00025*(100-p.colorQuality));
  return {bytes:Math.round(22_800_000*p.ratio+7_200_000*p.textureScale**2+1000*p.colorQuality),quality:{valid:true,retention}};
 },{maxEvaluations:18});
 expect(result.evaluations).toBe(18);
 expect(seen.some(p=>p.ratio<=.25&&p.textureScale>=.25)).toBe(true);
 expect(result.selection[0].candidate.bytes).toBeLessThan(11_922_748);
 expect(result.selection[0].candidate.quality.retention).toBeGreaterThanOrEqual(.9);
 expect(result.candidates.some(c=>c.proposalReason==='refine local measured quality crossing')).toBe(true);
});

test('a bad hybrid observation does not suppress other axes or inherit assumed monotonic quality',async()=>{
 const master={...row(10000,1),profile:{...adaptiveProfile(1,1,100,false),id:'master'}};
 const result=await searchQualityVariants(master,async p=>{
  const badIntermediate=p.ratio===.25&&p.textureScale===.5;
  const retention=badIntermediate?.82:Math.max(0,1-.025*Math.log2(1/p.ratio)-.004*(1/p.textureScale**2-1)-.0001*(100-p.colorQuality));
  return {bytes:Math.round(6000*p.ratio+3000*p.textureScale**2+100*p.colorQuality/100),quality:{valid:true,retention}};
 },{maxEvaluations:18});
 const rejected=result.candidates.find(c=>c.profile.ratio===.25&&c.profile.textureScale===.5);
 expect(rejected?.quality.retention).toBe(.82);
 const deeperGeometry=result.candidates.find(c=>c.profile.ratio<.25&&c.quality.retention!>=.9);
 expect(deeperGeometry).toBeDefined();
 expect(result.candidates.some(c=>c.profile.textureScale<.5)).toBe(true);
 const measuredBest=result.candidates.filter(c=>c.quality.valid&&c.quality.retention!>=.9).sort((a,b)=>a.bytes-b.bytes)[0];
 expect(result.selection[0].candidate).toBe(measuredBest);
});

test('a larger feasible budget cannot starve discovery for a smaller requested budget',async()=>{
 const master={...row(80_000_000,1),profile:{...adaptiveProfile(1,1,100,false),id:'master'}};
 const result=await searchQualityVariants(master,async p=>({
  // Hunyuan-shaped response: geometry0.5 cannot fit10MB, regardless of texture
  // reduction, but geometry0.25 can. Optimizing proximity to either budget used
  // to favor25MB anchors and never discover that valid smaller branch.
  bytes:Math.round(20_000_000*p.ratio+28_000_000*p.textureScale**2*(p.colorQuality/100)**2),
  quality:{valid:true,retention:1-.05*(1-p.ratio)-.015*(1-p.textureScale)-.01*(1-p.colorQuality/100)}
 }),{targets:[10_000_000,25_000_000],maxEvaluations:18});
 expect(result.evaluations).toBe(18);
 expect(result.selection.every(s=>s.met)).toBe(true);
 expect(result.selection[0].candidate.bytes).toBeLessThanOrEqual(10_000_000);
 expect(result.selection[0].candidate.profile.ratio).toBeLessThan(.5);
 expect(result.candidates.some(c=>c.proposalReason?.includes('for 10000000-byte requested budget'))).toBe(true);
 expect(result.candidates.some(c=>c.proposalReason?.includes('for 25000000-byte requested budget'))).toBe(true);
 for(const [index,target] of [10_000_000,25_000_000].entries()){
  const best=result.candidates.filter(c=>c.bytes<=target).sort((a,b)=>b.quality.retention!-a.quality.retention!||a.bytes-b.bytes)[0];
  expect(result.selection[index].candidate).toBe(best);
 }
});

test('infeasible tiny budgets get bounded discovery and do not suppress larger-budget refinement',async()=>{
 const master={...row(80_000_000,1),profile:{...adaptiveProfile(1,1,100,false),id:'master'}};
 const result=await searchQualityVariants(master,async p=>({
  bytes:Math.round(20_000_000*p.ratio+28_000_000*p.textureScale**2*(p.colorQuality/100)**2),
  quality:{valid:true,retention:1-.05*(1-p.ratio)-.015*(1-p.textureScale)-.01*(1-p.colorQuality/100)}
 }),{targets:[1,25_000_000],maxEvaluations:18});
 expect(result.evaluations).toBe(18);
 expect(result.selection[0].met).toBe(false);
 expect(result.selection[0].budgetMet).toBe(false);
 expect(result.selection[1].met).toBe(true);
 expect(result.candidates.some(c=>c.proposalReason?.includes('for 25000000-byte requested budget'))).toBe(true);
 expect(result.selection[1].candidate.quality.retention).toBeGreaterThan(.9655);
});

test('rejected hybrids receive measured one-axis quality repairs without an existing local passing neighbor',async()=>{
 for(const sensitiveAxis of [0,1,2]){
  const master={...row(100_000,1),profile:{...adaptiveProfile(1,1,100,false),id:'master'}};
  const result=await searchQualityVariants(master,async p=>{
   const reductions=[(1-p.ratio)/.5,(1-p.textureScale)/.5,(100-p.colorQuality)/20];
   const retention=Math.max(0,1-reductions.reduce((loss,amount,i)=>loss+amount*(i===sensitiveAxis?.08:.02),0));
   return {bytes:Math.round(100_000*(.7*p.ratio+.2*p.textureScale**2+.1*p.colorQuality/100)),quality:{valid:true,retention}};
  },{maxEvaluations:18});
  const hybrid=result.candidates.find(c=>c.proposalReason==='test a hybrid of measured reductions')!;
  expect(hybrid.quality.retention).toBeCloseTo(.88);
  const repair=result.candidates[hybrid.sequence+1];
  expect(repair.proposalReason).toStartWith('repair rejected hybrid by restoring ');
  expect(repair.quality.retention).toBeGreaterThanOrEqual(.9);
  const before=[hybrid.profile.ratio,hybrid.profile.textureScale,hybrid.profile.colorQuality];
  const after=[repair.profile.ratio,repair.profile.textureScale,repair.profile.colorQuality];
  expect(after.filter((v,i)=>v!==before[i]).length).toBe(1);
  expect(after[sensitiveAxis]).toBeGreaterThan(before[sensitiveAxis]);
  expect(result.evaluations).toBe(18);
  expect(result.selection[0].qualityAccepted).toBe(true);
 }
});
test('auto wrapper works without requested targets, preserves master and clips, and records failures safely',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'glb-auto-')),source=join(folder,'source.glb'),a=new Asset();a.joint('root',[0,0,0]);a.joint('arm',[.5,1,0],'root');a.ell('wood',[0,1,0],[.5,1,.4],'root');a.ell('wood',[.5,1,0],[.2,.6,.2],'arm');
 for(const name of ['idle','attack']){const clip=a.doc.createAnimation(name);a.channel(clip,'arm',[0,.5,1],[[0,0,0],[.3,0,0],[0,0,0]]);}
 const bytes=await a.bytes(),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');await Bun.write(source,bytes);let disposed=0,observations=0;
 const r=await generateVariants(source,{outDir:join(folder,'auto'),maxEvaluations:8,evaluator:{protocol:{testOnly:true},evaluate:async()=>({valid:true,retention:++observations===4?.88:1}),dispose:()=>{disposed++;}}});
 expect(r.strategy).toBe('auto');expect(r.variants.length).toBe(1);expect(r.variants[0].target.kind).toBe('quality');expect(r.variants[0].quality.retention).toBeGreaterThanOrEqual(.9);expect(r.evaluations).toBe(8);expect(r.attempts.length).toBe(8);
 expect(r.variants[0].inventory.clips.map(c=>c.name)).toEqual(['idle','attack']);expect(r.master.unchanged).toBe(true);expect(sha(new Uint8Array(await Bun.file(source).arrayBuffer()))).toBe(sha(bytes));expect(sha(new Uint8Array(await Bun.file(r.master.preservedPath).arrayBuffer()))).toBe(sha(bytes));expect(disposed).toBe(1);
 expect(existsSync(join(folder,'auto','optimization.json'))).toBe(true);expect(r.attempts.every(a=>a.path&&a.seconds>=a.transformSeconds)).toBe(true);
 await expect(generateVariants(source,{outDir:join(folder,'auto'),maxEvaluations:4,evaluator:{evaluate:async()=>({valid:true,retention:1})}})).rejects.toThrow('overwrite');
 const bad=join(folder,'blank');await expect(generateVariants(source,{outDir:bad,maxEvaluations:4,evaluator:{evaluate:async()=>({valid:false,retention:null,reason:'blank'}),dispose:()=>{disposed++;}}})).rejects.toThrow('baseline failed');expect((await Bun.file(join(bad,'optimization.json')).json()).status).toBe('failed');expect(disposed).toBe(2);
},60000);
test('accepted-master dev delivery uses native quality feedback and emits exactly one default variant',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'glb-auto-dev-')),source=join(folder,'accepted.glb'),out=join(folder,'delivery'),a=new Asset();a.joint('root',[0,0,0]);a.ell('wood',[0,1,0],[.5,1,.4],'root');await Bun.write(source,await a.bytes());
 const dev=join(import.meta.dir,'../scripts/dev.ts'),processHandle=Bun.spawn([process.execPath,dev,source,'--deliver',`--delivery-out=${out}`,'--max-evaluations=4','--no-sheet'],{stdout:'pipe',stderr:'pipe',windowsHide:true,env:{...process.env,GLB_CREATOR_CLEANUP:'off'}});
 const [stdout,stderr,code]=await Promise.all([new Response(processHandle.stdout).text(),new Response(processHandle.stderr).text(),processHandle.exited]);
 expect(code,stderr).toBe(0);const summary=JSON.parse(stdout.trim().split('\n').at(-1)!);expect(summary.ok).toBe(true);expect(summary.delivery.ok).toBe(true);expect(summary.delivery.variants.length).toBe(1);expect(summary.delivery.variants[0].retention).toBeGreaterThanOrEqual(.9);expect(summary.delivery.variants[0].qualityAccepted).toBe(true);
 const receipt=await Bun.file(join(out,'optimization.json')).json();expect(receipt.strategy).toBe('auto');expect(receipt.qualityProtocol.metricVersion).toContain('foreground');expect(receipt.evaluations).toBe(4);expect(receipt.master.unchanged).toBe(true);
},60000);
