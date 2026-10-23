/** Rendered similarity is an optimization proxy, never a calibrated human rating. */
export const QUALITY_METRIC_VERSION='foreground-ssim-color-edge-patch-v2';
export type QualityImage={pixels:Uint8Array;width:number;height:number};
export type FrameQuality={valid:boolean;retention:number|null;reason?:string;metrics?:{silhouetteIoU:number;structure:number;color:number;edge:number;rgbEdge:number;focalP10:number;meanAppearance:number;foregroundPixels:number;referenceForegroundPixels:number;candidateForegroundPixels:number}};
export type QualityObservation={valid:boolean;retention:number|null;reason?:string;frames?:any[];metrics?:Record<string,unknown>;metricVersion?:string;seconds?:number};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
function percentile(a:number[],q:number){if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),p=(s.length-1)*q,i=Math.floor(p);return s[i]+(s[Math.min(i+1,s.length-1)]-s[i])*(p-i);}

/** Alpha defines foreground. RGB under transparent pixels never contributes. */
export function compareQualityFrames(reference:QualityImage,candidate:QualityImage,options:{allowFullForeground?:boolean}={}):FrameQuality{
 const {width:w,height:h,pixels:a}=reference,b=candidate.pixels;
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<16||h<16||candidate.width!==w||candidate.height!==h||a.length!==w*h*4||b.length!==a.length)return {valid:false,retention:null,reason:'Mismatched or invalid RGBA dimensions'};
 const n=w*h,mask=new Uint8Array(n),am=new Uint8Array(n),bm=new Uint8Array(n),ay=new Float32Array(n),by=new Float32Array(n);
 let intersection=0,union=0,af=0,bf=0,colorError=0,minx=w,miny=h,maxx=-1,maxy=-1;
 for(let i=0;i<n;i++){
  const j=i*4;am[i]=a[j+3]>=128?1:0;bm[i]=b[j+3]>=128?1:0;af+=am[i];bf+=bm[i];
  if(am[i]&&bm[i])intersection++;
  if(!(am[i]||bm[i]))continue;
  mask[i]=1;union++;const x=i%w,y=Math.floor(i/w);minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y);
  // Missing foreground is black here and also penalized independently by IoU.
  let ar=am[i]?a[j]/255:0,ag=am[i]?a[j+1]/255:0,ab=am[i]?a[j+2]/255:0;
  let br=bm[i]?b[j]/255:0,bg=bm[i]?b[j+1]/255:0,bb=bm[i]?b[j+2]/255:0;
  ay[i]=.2126*ar+.7152*ag+.0722*ab;by[i]=.2126*br+.7152*bg+.0722*bb;
  colorError+=(Math.abs(ar-br)+Math.abs(ag-bg)+Math.abs(ab-bb))/3;
 }
 if(af<Math.max(16,n*.002)||bf<Math.max(16,n*.002))return {valid:false,retention:null,reason:'Empty or negligible rendered foreground'};
 if(!options.allowFullForeground&&(af>n*.98||bf>n*.98))return {valid:false,retention:null,reason:'Missing transparent background; foreground mask cannot be trusted'};
 const stats=(x0:number,y0:number,x1:number,y1:number)=>{
  let count=0,sa=0,sb=0,saa=0,sbb=0,sab=0,ce=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
   const i=y*w+x;if(!mask[i])continue;const av=ay[i],bv=by[i];count++;sa+=av;sb+=bv;saa+=av*av;sbb+=bv*bv;sab+=av*bv;
   const j=i*4;for(let k=0;k<3;k++)ce+=Math.abs((am[i]?a[j+k]:0)-(bm[i]?b[j+k]:0))/765;
  }
  if(count<4)return null;
  const ma=sa/count,mb=sb/count,va=Math.max(0,saa/count-ma*ma),vb=Math.max(0,sbb/count-mb*mb),cov=sab/count-ma*mb;
  const ssim=clamp(((2*ma*mb+.0001)*(2*cov+.0009))/((ma*ma+mb*mb+.0001)*(va+vb+.0009)));
  return {count,ssim,color:clamp(1-ce/count)};
 };
 let structuralSum=0,structuralWeight=0;
 // Two local scales; only actual object samples contribute to either.
 for(const tile of [8,16])for(let y=0;y<h;y+=tile)for(let x=0;x<w;x+=tile){const s=stats(x,y,Math.min(w,x+tile),Math.min(h,y+tile));if(s){structuralSum+=s.ssim*s.count;structuralWeight+=s.count;}}
 const structure=structuralWeight?structuralSum/structuralWeight:0,color=clamp(1-colorError/union);
 let edgeError=0,edgeEnergy=0,rgbEdgeError=0,rgbEdgeEnergy=0,edgeCount=0;
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x;if(!am[i]||!bm[i]||!am[i-1]||!bm[i-1]||!am[i+1]||!bm[i+1]||!am[i-w]||!bm[i-w]||!am[i+w]||!bm[i+w])continue;
  const ax=(ay[i+1]-ay[i-1])*.5,az=(ay[i+w]-ay[i-w])*.5,bx=(by[i+1]-by[i-1])*.5,bz=(by[i+w]-by[i-w])*.5;
  edgeError+=Math.abs(ax-bx)+Math.abs(az-bz);edgeEnergy+=Math.abs(ax)+Math.abs(az)+Math.abs(bx)+Math.abs(bz);edgeCount++;
  // Luminance alone cannot see detail formed by colors of equal brightness.
  // All five samples are foreground in both images, so hidden RGB is excluded.
  for(let channel=0;channel<3;channel++){
   const ax=(a[(i+1)*4+channel]-a[(i-1)*4+channel])/510,az=(a[(i+w)*4+channel]-a[(i-w)*4+channel])/510;
   const bx=(b[(i+1)*4+channel]-b[(i-1)*4+channel])/510,bz=(b[(i+w)*4+channel]-b[(i-w)*4+channel])/510;
   rgbEdgeError+=(Math.abs(ax-bx)+Math.abs(az-bz))/3;rgbEdgeEnergy+=(Math.abs(ax)+Math.abs(az)+Math.abs(bx)+Math.abs(bz))/3;
  }
 }
 const edge=clamp(1-edgeError/(edgeEnergy*.65+edgeCount*.01+1e-9)),rgbEdge=clamp(1-rgbEdgeError/(rgbEdgeEnergy*.65+edgeCount*.01+1e-9)),patches:number[]=[];
 for(let py=0;py<4;py++)for(let px=0;px<4;px++){
  const x0=minx+Math.floor((maxx-minx+1)*px/4),x1=minx+Math.floor((maxx-minx+1)*(px+1)/4),y0=miny+Math.floor((maxy-miny+1)*py/4),y1=miny+Math.floor((maxy-miny+1)*(py+1)/4);
  const s=stats(x0,y0,x1,y1);if(s&&s.count>=16)patches.push(.7*s.ssim+.3*s.color);
 }
 if(!patches.length||!structuralWeight)return {valid:false,retention:null,reason:'Insufficient object evidence for similarity'};
 const silhouetteIoU=intersection/union,focalP10=percentile(patches,.1),meanAppearance=.55*structure+.25*color+.2*edge;
 // Each signal is an independent guard. v1's weighted appearance mean allowed
 // high SSIM/color to hide lost texture detail: .6 edge could still score .9.
 // Retained PNG calibration motivates this conservative change; .9 remains an
 // image proxy threshold, not a calibrated percentage of human visual quality.
 const retention=clamp(Math.min(silhouetteIoU,meanAppearance,focalP10,edge,rgbEdge));
 return {valid:true,retention,metrics:{silhouetteIoU,structure,color,edge,rgbEdge,focalP10,meanAppearance,foregroundPixels:union,referenceForegroundPixels:af,candidateForegroundPixels:bf}};
}

export type QualityEvaluatorOptions={size?:number;maxAnimationSamples?:number;maxFrames?:number;captureDir?:string};
/** Lazy native renderer keeps pure image comparisons cheap and testable. */
export async function createQualityEvaluator(masterBytes:Uint8Array,options:QualityEvaluatorOptions={}){
 const {createRenderedQualityEvaluator}=await import('./quality-metric-renderer');
 return createRenderedQualityEvaluator(masterBytes,options);
}
