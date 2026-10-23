import {createHash} from 'node:crypto';
import {existsSync,mkdirSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {createVariantContext,parseVariantTarget,transformVariantCandidate,type VariantOptions} from './variants';
import {adaptiveProfile,measured,searchQualityVariants,type QualityObservation,type SearchCandidate} from './optimize-search';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');

/** Quality-guided delivery; no target means smallest measured >=90% retention. */
export async function optimizeVariants(masterPath:string,options:VariantOptions){
 const started=performance.now(),source=resolve(masterPath),outDir=resolve(options.outDir),imageFormat=options.imageFormat??'webp',limit=options.maxEvaluations??18;
 if(!Number.isInteger(limit)||limit<4||limit>128)throw Error('maxEvaluations must be an integer4..128');
 if(!['webp','core'].includes(imageFormat))throw Error('Unknown image format');
 if(options.minRetention!=null&&(!Number.isFinite(options.minRetention)||options.minRetention<0||options.minRetention>1))throw Error('minRetention must be0..1');
 const sourceBytes=new Uint8Array(await Bun.file(source).arrayBuffer()),sourceSHA256=sha(sourceBytes),targets=(options.targets??[]).map(t=>parseVariantTarget(t,sourceBytes.length)),baseStrategy=options.baseStrategy??basename(source,'.glb');
 const copy=join(outDir,'master.glb'),receiptPath=join(outDir,'variants.json'),candidateDir=join(outDir,'candidates');
 const labels=targets.length?targets.map(t=>t.label):['auto'],outputs=labels.map((label,i)=>join(outDir,`variant-${String(i+1).padStart(2,'0')}-${label.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}.glb`));
 for(const path of [copy,receiptPath,join(outDir,'optimization.json'),join(outDir,'progress.json'),candidateDir,...outputs]){
  if(resolve(path).toLowerCase()===source.toLowerCase())throw Error('Output must never overwrite input master');
  if(existsSync(path))throw Error(`Refusing to overwrite existing artifact: ${path}`);
 }
 mkdirSync(candidateDir,{recursive:true});await Bun.write(copy,sourceBytes);
 const context=await createVariantContext(sourceBytes),sourceInventory=context.sourceInventory;
 const activeAxes:('geometry'|'texture'|'coding')[]=['geometry'];
 if(context.textureCapabilities.some(t=>t.resizable))activeAxes.push('texture');
 if(context.textureCapabilities.some(t=>t.resizable&&t.color&&(imageFormat==='webp'||t.opaque)))activeAxes.push('coding');
 let evaluator=options.evaluator;
 const rawAttempts:any[]=[];let result:any;
 try{
  evaluator??=await (await import('./quality-metric')).createQualityEvaluator(sourceBytes,options.qualityOptions as any);
  const baselineStarted=performance.now(),baselineQuality:QualityObservation=await evaluator.evaluate(sourceBytes);
  const baseline:SearchCandidate={profile:{...adaptiveProfile(1,1,100,false),id:'master-byte-exact'},sequence:0,bytes:sourceBytes.length,quality:baselineQuality,path:copy,sha256:sourceSHA256,seconds:(performance.now()-baselineStarted)/1000,lossless:true,inventory:sourceInventory,status:'baseline'};
  if(!measured(baseline))throw Error(`Master render baseline failed: ${baselineQuality.reason??'invalid, non-finite or blank quality observation'}`);
  const qualityCache=new Map([[sourceSHA256,{quality:baselineQuality,profile:baseline.profile.id}]]);let renderedCandidates=0;
  const search=await searchQualityVariants(baseline,async profile=>{
   const attemptStarted=performance.now();let attempt:any={profile,baseStrategy,subStrategy:`adaptive measured search / ${profile.id}`,status:'running'};
   try{
    const built=await transformVariantCandidate(sourceBytes,profile,{imageFormat,baseStrategy,context}),path=join(candidateDir,profile.id+'.glb');
    await Bun.write(path,built.bytes);
    const digest=built.attempt.sha256,cached=qualityCache.get(digest);
    const quality=cached?{...cached.quality}:await evaluator.evaluate(built.bytes);if(!cached){renderedCandidates++;if(measured({bytes:built.bytes.length,quality}))qualityCache.set(digest,{quality,profile:profile.id});}
    attempt={...built.attempt,profile,baseStrategy,subStrategy:`adaptive measured search / ${profile.id}`,path,quality,qualityReuse:cached?{sha256:digest,fromProfile:cached.profile,reason:'Byte-identical GLB under the same frozen evaluator'}:null,transformSeconds:built.attempt.seconds,seconds:(performance.now()-attemptStarted)/1000};
    if(!measured({bytes:built.bytes.length,quality}))attempt.status='quality-invalid';
    else attempt.status='evaluated';
   }catch(error){attempt={...attempt,status:'failed',bytes:0,quality:{valid:false,retention:null,reason:String(error)},seconds:(performance.now()-attemptStarted)/1000,error:String(error)};}
   rawAttempts.push(attempt);
   await Bun.write(join(outDir,'progress.json'),JSON.stringify({schemaVersion:1,masterSHA256:sourceSHA256,strategy:'auto',attempts:rawAttempts,elapsedSeconds:(performance.now()-started)/1000},null,2));
   options.onProgress?.({profile:profile.id,status:attempt.status,bytes:attempt.bytes,retention:attempt.quality.retention,seconds:attempt.seconds,evaluations:rawAttempts.length,maxEvaluations:limit});
   return attempt;
  },{targets:targets.map(t=>t.bytes),minRetention:options.minRetention,maxEvaluations:limit,activeAxes});
  for(const attempt of rawAttempts)attempt.proposalReason=search.candidates.find(c=>c.profile.id===attempt.profile.id)?.proposalReason??'independent seed probe';
  const variants=[];
  for(const [i,selected] of search.selection.entries()){
   const c=selected.candidate,bytes=new Uint8Array(await Bun.file(c.path).arrayBuffer());
   if(sha(bytes)!==c.sha256)throw Error('Selected candidate changed after quality evaluation');
   await Bun.write(outputs[i],bytes);
   variants.push({target:targets[i]??{label:'auto',kind:'quality',minRetention:options.minRetention??.9},status:selected.met?'met':'unmet',budgetMet:selected.budgetMet,qualityAccepted:selected.qualityAccepted,minimumRetention:selected.floor,belowDefaultRetention:c.quality.retention!<.9,path:outputs[i],bytes:bytes.length,sha256:c.sha256,profile:c.profile.id,subStrategy:`adaptive measured search / ${c.profile.id}`,candidateSeconds:c.seconds,resolvedAtSeconds:(performance.now()-started)/1000,lossless:c.lossless,inventory:c.inventory,quality:c.quality,reason:selected.met?targets.length?'Highest measured retention among tested candidates inside this budget; byte size breaks quality ties.':'Smallest tested candidate meeting the measured retention floor.':selected.budgetMet===false?'No tested valid candidate meets the byte target and any explicitly requested quality floor.':'No tested candidate meets the explicitly requested quality floor.'});
  }
  if(sha(new Uint8Array(await Bun.file(source).arrayBuffer()))!==sourceSHA256)throw Error('Master file changed during optimization');
  result={schemaVersion:1,status:variants.every(v=>v.status==='met')?'complete':'partial',strategy:'auto',baseStrategy,imageFormat,master:{source,preservedPath:copy,bytes:sourceBytes.length,sha256:sourceSHA256,unchanged:true,inventory:sourceInventory},variants,baseline:{quality:baselineQuality,seconds:baseline.seconds},attempts:rawAttempts,qualityProtocol:evaluator.protocol??{source:'caller-injected evaluator',requiresIndependentCalibration:true},evaluations:search.evaluations,evaluationLimit:limit,totalSeconds:(performance.now()-started)/1000,
   selection:targets.length?'Maximize measured appearance retention within each byte budget; smaller bytes break equal-retention ties. No90% floor is imposed on budgets unless minRetention is explicitly supplied.':'Minimize tested bytes subject to measured retention>=minRetention (default0.90); retain the measured master when no smaller tested candidate passes.',
   search:search.search,activeAxes,renderedCandidates,reusedMeasurements:rawAttempts.filter(a=>a.qualityReuse).length,parameterBounds:{geometryRatio:[.025,1],textureScale:[.0625,1],colorQuality:[35,100],positionBits:16,normalBits:12,uvBits:16,floatColorBits:16},qualityMeaning:'Estimated rendered appearance retention relative to this master, not a human quality/10 rating or a guarantee of90% perceived quality.',
   perceptualAcceptance:{status:'pending-independent-review',requiredForDefault:targets.length===0,defaultMaximumJudgedLoss:.1,meaning:'Complete means the bounded proxy search finished. Compare selected deliverables with the unchanged master; reject a default with more than10% judged perceived loss and retry conservatively or use verified lossless fallback.'},
   timingScope:'Total includes baseline setup/rendering, every transform/render/rejected attempt, validation and selected artifact writes. candidateSeconds is only that selected attempt; neither includes earlier master authoring.',
   limits:['Finite measured search returns the best tested output, not a proven global optimum or theoretical smallest GLB.','Metric retention is a visual proxy and needs calibration against blind human/agent review;10% proxy loss is not a guaranteed10% human perceptual loss.','Reference fidelity cannot improve by optimizing a weak master. Hidden geometry, game-engine import/mips and deformation acceptance require separate review.','All candidates start from original master bytes. Blank, invalid, non-finite or failed evaluations are excluded.','Explicit small budgets can retain less than90%; belowDefaultRetention flags this unless caller supplies a hard floor.','Meshopt/WebP require compatible loaders. Decoding creates an inspection derivative, not restored source detail.']};
  await Bun.write(receiptPath,JSON.stringify(result,null,2));await Bun.write(join(outDir,'optimization.json'),JSON.stringify(result,null,2));
  return result;
 }catch(error){await Bun.write(join(outDir,'optimization.json'),JSON.stringify({schemaVersion:1,status:'failed',strategy:'auto',master:{source,sha256:sourceSHA256,preservedPath:copy},attempts:rawAttempts,totalSeconds:(performance.now()-started)/1000,error:String(error)},null,2));throw error;}
 finally{await evaluator?.dispose?.();}
}

if(import.meta.main){
 const args=process.argv.slice(2),get=(name:string)=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3),input=args.find(a=>!a.startsWith('--'));
 if(!input||!get('out')){console.error('Usage: bun run optimize -- MASTER.glb --out=NEW_FOLDER [--targets=10MB,25%] [--min-retention=.9] [--max-evaluations=18]');process.exit(2);}
 try{const r=await optimizeVariants(input,{outDir:get('out')!,targets:get('targets')?.split(',').filter(Boolean),minRetention:get('min-retention')?Number(get('min-retention')):undefined,maxEvaluations:get('max-evaluations')?Number(get('max-evaluations')):undefined,imageFormat:get('image-format') as any,baseStrategy:get('base-strategy'),onProgress:e=>console.error(JSON.stringify(e))});console.log(JSON.stringify({ok:r.status==='complete',receipt:join(resolve(get('out')!),'variants.json'),masterUnchanged:r.master.unchanged,totalSeconds:r.totalSeconds,variants:r.variants.map(v=>({target:v.target.label,status:v.status,bytes:v.bytes,retention:v.quality.retention,profile:v.profile,path:v.path}))}));}
 catch(error){console.error(String(error));process.exit(1);}
}
