import type {VariantProfile} from './variants';

export type QualityObservation={valid:boolean;retention:number|null;reason?:string;frames?:unknown[];metrics?:Record<string,unknown>;[key:string]:unknown};
export type SearchObservation={bytes:number;quality:QualityObservation;[key:string]:any};
export type SearchCandidate=SearchObservation&{profile:VariantProfile;sequence:number};
export type SearchOptions={targets?:number[];minRetention?:number;maxEvaluations?:number;activeAxes?:('geometry'|'texture'|'coding')[]};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export const profileKey=(p:VariantProfile)=>[p.quantize?1:0,p.ratio.toFixed(4),p.textureScale.toFixed(4),Math.round(p.colorQuality)].join(':');
export function adaptiveProfile(ratio=1,textureScale=1,colorQuality=100,quantize=true):VariantProfile{
 ratio=Number(clamp(ratio,.025,1).toFixed(4));textureScale=Number(clamp(textureScale,.0625,1).toFixed(4));colorQuality=Math.round(clamp(colorQuality,35,100));
 return {id:`auto-g${Math.round(ratio*10000)}-t${Math.round(textureScale*10000)}-c${colorQuality}-${quantize?'p16':'raw'}`,ratio,textureScale,colorQuality,quantize,error:ratio===1?0:Math.max(.0001,(1-ratio)*.012)};
}
export function measured(candidate:SearchObservation){const q=candidate.quality;return q?.valid===true&&typeof q.retention==='number'&&Number.isFinite(q.retention)&&q.retention>=0&&q.retention<=1&&Number.isSafeInteger(candidate.bytes)&&candidate.bytes>0;}
export function selectOptimized(candidates:SearchCandidate[],targetBytes:number|null,minRetention?:number){
 const valid=candidates.filter(measured),floor=minRetention??(targetBytes==null?.9:0),accepted=valid.filter(c=>c.quality.retention!>=floor),fits=accepted.filter(c=>targetBytes==null||c.bytes<=targetBytes);
 const byQuality=(a:SearchCandidate,b:SearchCandidate)=>b.quality.retention!-a.quality.retention!||a.bytes-b.bytes;
 const bySize=(a:SearchCandidate,b:SearchCandidate)=>a.bytes-b.bytes||byQuality(a,b);
 const chosen=fits.sort(targetBytes==null?bySize:byQuality)[0]??accepted.sort(bySize)[0]??valid.sort(byQuality)[0];
 if(!chosen)throw Error('No candidate has a valid rendered quality observation');
 return {candidate:chosen,budgetMet:targetBytes==null?null:chosen.bytes<=targetBytes,qualityAccepted:chosen.quality.retention!>=floor,floor,met:(targetBytes==null||chosen.bytes<=targetBytes)&&chosen.quality.retention!>=floor};
}
function frontier(rows:SearchCandidate[]){return rows.filter(measured).filter(r=>!rows.some(t=>measured(t)&&t.bytes<=r.bytes&&t.quality.retention!>=r.quality.retention!&&(t.bytes<r.bytes||t.quality.retention!>r.quality.retention!)));}
function blend(a:VariantProfile,b:VariantProfile,f=.5){return adaptiveProfile(a.ratio*(1-f)+b.ratio*f,a.textureScale*(1-f)+b.textureScale*f,a.colorQuality*(1-f)+b.colorQuality*f,a.quantize||b.quantize);}
type Axis='geometry'|'texture'|'coding';
type Offer={p:VariantProfile;priority:number;reason:string;kind:Axis|'refine'|'hybrid'|'restore'|'repair'};
const dimensions=(p:VariantProfile)=>[p.ratio,p.textureScale,p.colorQuality];
const sameAxis=(a:VariantProfile,b:VariantProfile)=>a.quantize===b.quantize&&dimensions(a).filter((v,i)=>v!==dimensions(b)[i]).length===1;
const exceptAxis=(a:VariantProfile,b:VariantProfile,axis:number)=>a.quantize===b.quantize&&dimensions(a).every((v,i)=>i===axis||v===dimensions(b)[i]);
const restoreAxis=(p:VariantProfile,axis:number,value:number)=>{const d=dimensions(p);d[axis]=value;return adaptiveProfile(d[0],d[1],d[2],p.quantize);};

/** Bounded measured search. Every proposal is judged; quality is not assumed monotonic. */
export async function searchQualityVariants(master:SearchCandidate,evaluate:(profile:VariantProfile)=>Promise<SearchObservation>,options:SearchOptions={}){
 const max=options.maxEvaluations??18;if(!Number.isInteger(max)||max<4||max>128)throw Error('maxEvaluations must be an integer4..128');
 const targets=options.targets??[];if(targets.some(n=>!Number.isSafeInteger(n)||n<1))throw Error('Invalid search byte target');
 if(options.minRetention!=null&&(!Number.isFinite(options.minRetention)||options.minRetention<0||options.minRetention>1))throw Error('minRetention must be0..1');
 if(!measured(master))throw Error('Master quality baseline is invalid or blank');
 const active=new Set(options.activeAxes??['geometry','texture','coding']);if([...active].some(a=>!['geometry','texture','coding'].includes(a)))throw Error('Unknown active reduction axis');
 const applicable=(p:VariantProfile)=>adaptiveProfile(active.has('geometry')?p.ratio:1,active.has('texture')?p.textureScale:1,active.has('coding')?p.colorQuality:100,p.quantize);
 const rows=[master],seen=new Set([profileKey(master.profile)]),base=adaptiveProfile(),seeds=[adaptiveProfile(1,1,100,false),base,adaptiveProfile(.5,1,100),adaptiveProfile(1,.5,100),adaptiveProfile(1,1,80)].map(applicable);
 // The byte-exact master has the same parameters as lossless packing. Its
 // representation differs, so leave that profile available for one real trial.
 seen.delete(profileKey(master.profile));
 const run=async(p:VariantProfile)=>{seen.add(profileKey(p));let observation:SearchObservation;try{observation=await evaluate(p);}catch(e){observation={bytes:0,quality:{valid:false,retention:null,reason:String(e)},error:String(e)};}const row={...observation,profile:p,sequence:rows.length};rows.push(row);return row;};
 for(const p of seeds){if(rows.length-1>=max)break;if(!seen.has(profileKey(p)))await run(p);}
 // With one active axis and no size budgets, multi-axis fairness only repeats
 // distant rejected reductions. Probe a remote point, then spend the bounded
 // search near the smallest observed passing/rejected bracket. This is still
 // best-tested selection, not a monotonicity or global-minimum guarantee.
 if(active.size===1&&!targets.length){
  const axis=[...active][0],dimension=axis==='geometry'?0:axis==='texture'?1:2,minimum=dimension===0?.025:dimension===1?.0625:35,maximum=dimension===2?100:1,tolerance=dimension===2?1:1/256;
  const value=(r:SearchCandidate)=>dimensions(r.profile)[dimension],floor=options.minRetention??.9;
  const remote=applicable(restoreAxis(base,dimension,dimension===2?55:.25));
  if(rows.length-1<max&&!seen.has(profileKey(remote)))await run(remote);
  while(rows.length-1<max){
   const valid=rows.filter(r=>measured(r)&&r.profile.quantize),passing=valid.filter(r=>r.quality.retention!>=floor).sort((a,b)=>value(a)-value(b)||a.bytes-b.bytes),good=passing[0];
   if(!good)break; // Retain a measured raw/master fallback when packing fails.
   const bad=valid.filter(r=>r.quality.retention!<floor&&value(r)<value(good)).sort((a,b)=>value(b)-value(a))[0];
   let nextValue:number,reason:string;
   if(bad){
    const gap=value(good)-value(bad);if(gap<=tolerance)break;
    const dq=good.quality.retention!-bad.quality.retention!,fraction=dq>0?clamp((floor-bad.quality.retention!)/dq,.2,.8):.5;
    nextValue=value(bad)+gap*fraction;reason='refine one-axis observed quality crossing';
   }else{
    if(value(good)<=minimum+tolerance)break;
    nextValue=Math.max(minimum,value(good)*.5);reason='explore below the smallest measured one-axis passing point';
   }
   if(dimension===2)nextValue=Math.round(nextValue);
   let proposal=applicable(restoreAxis(base,dimension,nextValue));
   if(seen.has(profileKey(proposal))&&bad)proposal=applicable(restoreAxis(base,dimension,(value(good)+value(bad))/2));
   if(seen.has(profileKey(proposal)))break;
   const row=await run(proposal);row.proposalReason=reason;
  }
  return {candidates:rows,selection:[selectOptimized(rows,null,options.minRetention)],evaluations:rows.length-1,activeAxes:[...active],search:'Single applicable axis: independent packing/reduction seeds and one remote probe, then measured local quality-crossing refinement with bounded parameter resolution. Stops at the bracket resolution or evaluation limit; no monotonicity or global-minimum guarantee.'};
 }
 let round=0;
 // Reserve exploration slots for every reduction axis. A quality crossing must
 // not consume the entire finite search budget: a texture-bound tiny-quality-
 // margin winner can hide a much better geometry branch with larger textures.
 const schedule:(Axis|'refine'|'repair')[]=['geometry','texture','repair','geometry','texture','refine','coding','geometry','repair','texture','coding','refine'];
 const budgets=[...new Set(targets)].sort((a,b)=>a-b);
 const discoverySlots=Math.ceil(Math.max(0,max-(rows.length-1))/2);
 let budgetCursor=0;
 while(rows.length-1<max){
  const accepted=frontier(rows),offers:Offer[]=[],add=(proposal:VariantProfile,priority:number,reason:string,kind:Offer['kind'])=>{const p=applicable(proposal);if(!seen.has(profileKey(p)))offers.push({p,priority,reason,kind});};
  const floor=options.minRetention??(targets.length?0:.9);
  // A larger feasible budget must not hide an unmet smaller budget. Give the
  // first half of adaptive trials to finding a valid fit, then rotate objectives
  // fairly. Bounding discovery also prevents an impossible tiny target from
  // consuming every trial needed to improve other requested deliveries.
  const unmet=budgets.filter(t=>!selectOptimized(rows,t,options.minRetention).met);
  const focus=round<discoverySlots&&unmet.length?unmet[0]:budgets.length?budgets[budgetCursor++%budgets.length]:null;
  // Prefer compact passing anchors with enough quality margin to test another
  // axis. The score still admits near-boundary anchors once those probes are
  // exhausted; no measured branch is pruned by a monotonicity assumption.
  for(const r of accepted){
   const p=r.profile,qual=r.quality.retention!,pass=qual>=floor;
   const score=focus!=null?3*qual-Math.abs(Math.log(r.bytes/focus)):Math.log(master.bytes/r.bytes)+8*(qual-floor);
   if(pass){
    add(adaptiveProfile(p.ratio*.5,p.textureScale,p.colorQuality,true),score,'reduce geometry from measured frontier with quality margin','geometry');
    add(adaptiveProfile(p.ratio,p.textureScale*.5,p.colorQuality,true),score,'reduce texture from measured frontier with quality margin','texture');
    add(adaptiveProfile(p.ratio,p.textureScale,p.colorQuality===100?80:p.colorQuality-12,true),score,'change color coding from measured frontier with quality margin','coding');
   }
   if(focus!=null&&r.bytes<=focus){
    add(adaptiveProfile((p.ratio+1)/2,p.textureScale,p.colorQuality,true),score+.2,'restore geometry toward a requested budget','restore');
    add(adaptiveProfile(p.ratio,(p.textureScale+1)/2,p.colorQuality,true),score+.2,'restore texture toward a requested budget','restore');
    add(adaptiveProfile(p.ratio,p.textureScale,(p.colorQuality+100)/2,true),score+.1,'restore color fidelity toward a requested budget','restore');
   }
  }
  // Refine local, single-axis observed crossings. Interpolating an arbitrary
  // distant master/rejected pair changes several axes and can repeatedly make
  // larger dominated variants; it is not useful boundary refinement.
  for(const a of accepted)for(const b of rows.filter(measured)){
   if(a===b||!sameAxis(a.profile,b.profile))continue;
   const qualityCross=!targets.length&&(a.quality.retention!>=floor)!==(b.quality.retention!>=floor);
   if(qualityCross){
    const predictedBytes=Math.sqrt(a.bytes*b.bytes);
    add(blend(a.profile,b.profile),Math.log(master.bytes/predictedBytes)+Math.max(a.quality.retention!,b.quality.retention!),'refine local measured quality crossing','refine');
   }
   for(const target of focus==null?[]:[focus]){
    if((a.bytes<=target)===(b.bytes<=target))continue;
    const f=Math.abs(Math.log(b.bytes/a.bytes))<1e-8?.5:clamp(Math.log(target/a.bytes)/Math.log(b.bytes/a.bytes),.15,.85);
    add(blend(a.profile,b.profile,f),3*Math.max(a.quality.retention!,b.quality.retention!),'refine local measured byte-budget crossing','refine');
   }
  }
  // Hybrids combine independently successful reductions; their quality is
  // measured afresh rather than multiplying or inheriting component scores.
  const passing=rows.filter(r=>measured(r)&&r.quality.retention!>=Math.max(floor,.75));
  const g=[...passing].sort((a,b)=>a.profile.ratio-b.profile.ratio)[0],t=[...passing].sort((a,b)=>a.profile.textureScale-b.profile.textureScale)[0],c=[...passing].sort((a,b)=>a.profile.colorQuality-b.profile.colorQuality)[0];
  if(g&&t&&c)add(adaptiveProfile(g.profile.ratio,t.profile.textureScale,c.profile.colorQuality),2.5,'test a hybrid of measured reductions','hybrid');
  // A rejected combination is not evidence that every component reduction was
  // wrong. Repair one axis at a time, including color settings between the
  // coarse probes, rather than blending every parameter back toward the master.
  // Seed observations estimate which axis is most quality-sensitive; repairs
  // remain hypotheses that must be rendered, never inherited quality scores.
  if(!targets.length){
   const valid=rows.filter(measured),maximum=[1,1,100],axisNames=['geometry','texture','color coding'];
   const slopes=maximum.map((scale,axis)=>{
    let slope=0;
    for(const a of valid)for(const b of valid){
     if(!exceptAxis(a.profile,b.profile,axis))continue;
     const delta=(dimensions(b.profile)[axis]-dimensions(a.profile)[axis])/scale;
     if(delta>0)slope=Math.max(slope,(b.quality.retention!-a.quality.retention!)/delta);
    }
    return Math.min(1,slope);
   });
   for(const r of valid){
    const d=dimensions(r.profile),qual=r.quality.retention!;
    if(qual>=floor||qual<Math.max(0,floor-.15)||d.filter((v,i)=>v<maximum[i]).length<2)continue;
    for(let axis=0;axis<3;axis++){
     if(d[axis]>=maximum[axis])continue;
     const neighbor=valid.filter(n=>exceptAxis(r.profile,n.profile,axis)&&dimensions(n.profile)[axis]>d[axis]&&n.quality.retention!>qual)
      .sort((a,b)=>dimensions(a.profile)[axis]-dimensions(b.profile)[axis])[0];
     const bound=neighbor?dimensions(neighbor.profile)[axis]:maximum[axis],value=(d[axis]+bound)/2;
     const estimatedGain=slopes[axis]*(value-d[axis])/maximum[axis];
     const priority=Math.log(master.bytes/r.bytes)-12*(floor-qual)+4*estimatedGain-.15*Math.log(value/d[axis]);
     add(restoreAxis(r.profile,axis,value),priority,`repair rejected hybrid by restoring ${axisNames[axis]}`,'repair');
    }
   }
  }
  // During a no-budget search, an over-limit smallest sample still deserves a
  // local relaxation even when no non-dominated quality crossing was found.
  if(!targets.length){
   const good=selectOptimized(rows,null,options.minRetention).candidate;
   const bad=rows.filter(r=>measured(r)&&r.quality.retention!<floor&&r.bytes<good.bytes)
    .sort((a,b)=>Math.abs(Math.log(a.bytes/good.bytes))-Math.abs(Math.log(b.bytes/good.bytes)))[0];
   if(bad&&!sameAxis(good.profile,bad.profile))add(blend(good.profile,bad.profile),Math.log(master.bytes/good.bytes)-.5,'refine nearby hybrid passing / rejected quality pair','refine');
  }
  const ranked=offers.sort((a,b)=>b.priority-a.priority||profileKey(a.p).localeCompare(profileKey(b.p)));
  // First verify the independent reductions together. Thereafter interleave
  // measured axis exploration with local refinement rather than allowing either
  // to starve the other. Missing categories fall back to any useful proposal.
  const last=rows.at(-1)!,justRejectedHybrid=!targets.length&&last.proposalReason?.startsWith('test a hybrid')&&measured(last)&&last.quality.retention!<floor;
  const category=round===0?'hybrid':justRejectedHybrid?'repair':schedule[(round-1)%schedule.length];
  const next=ranked.find(o=>o.kind===category)
   ??(category==='refine'?ranked.find(o=>o.kind==='restore'||o.kind==='hybrid'):undefined)
   ??(category==='repair'?ranked.find(o=>o.kind==='refine'):undefined)
   ??ranked[0];if(!next)break;
  const result=await run(next.p);result.proposalReason=next.reason+(focus==null?'':` for ${focus}-byte requested budget`);round++;
 }
 return {candidates:rows,selection:targets.length?targets.map(t=>selectOptimized(rows,t,options.minRetention)):[selectOptimized(rows,null,options.minRetention)],evaluations:rows.length-1,activeAxes:[...active],search:'Content-aware axis-fair exploration from quality-margin Pareto anchors, local constraint refinement, one-axis repairs of rejected hybrids and measured hybrid verification. Unmet-budget discovery gets bounded priority before fair rotation across requested budgets. Bounded; no global minimum or monotonic quality assumption.'};
}
