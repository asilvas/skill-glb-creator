/**
 * One-shot iteration command: build a recipe (or take a GLB), validate it, render a
 * labeled multi-view contact sheet, and print ONE compact JSON summary line.
 *
 *   bun run dev -- tmp/asset.ts [--size=416] [--views="time,yaw,label;..."] [--out=...] [--sheet=...] [--no-sheet]
 *
 * The recipe default-exports an async function returning an Asset or GLB bytes.
 * Read the sheet image with your file/image reader; never print GLB bytes or base64.
 */
import { resolve,basename,relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT,TMP } from './paths';
import { Preview,type View } from './preview';
import { validate } from './validate';

const args=process.argv.slice(2);
const input=args.find(a=>!a.startsWith('--'));
if(!input){console.error('Usage: bun run dev -- tmp/asset.ts');process.exit(2);}
const opt=(name:string)=>args.find(a=>a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const absInput=resolve(ROOT,input),stem=basename(input).replace(/\.(ts|js|glb)$/,'');
const t0=performance.now();let bytes:Uint8Array;
try{
  if(absInput.endsWith('.glb'))bytes=new Uint8Array(await Bun.file(absInput).arrayBuffer());
  else{
    const mod=await import(pathToFileURL(absInput).href),build=mod.default??mod.build;
    if(typeof build!=='function')throw Error('Recipe must default-export an async build() returning an Asset or GLB bytes');
    const built=await build();
    bytes=built instanceof Uint8Array?built:await built.bytes();
    const out=resolve(ROOT,opt('out')??resolve(TMP,`${stem}.glb`));
    await Bun.write(out,bytes);
  }
}catch(e:any){
  console.log(JSON.stringify({ok:false,stage:'build',error:String(e?.stack?.split('\n').slice(0,4).join(' | ')??e)}));
  process.exit(1);
}
const buildMs=performance.now()-t0;

const v0=performance.now(),v=await validate(bytes);
const issues=(v.report.issues.messages??[]).filter((m:any)=>m.severity<=1).slice(0,5).map((m:any)=>`${m.code}: ${m.pointer}`);
const validateMs=performance.now()-v0;

let sheetInfo:any=null,dims:any=null,renderMs=0;
if(!args.includes('--no-sheet')){
  const r0=performance.now(),preview=await Preview.create();
  try{
    await preview.load(bytes);
    const r=preview.restBounds,size=[r.max.x-r.min.x,r.max.y-r.min.y,r.max.z-r.min.z].map(x=>Math.round(x*100)/100);
    dims={height:size[1],size,minY:Math.round(r.min.y*1000)/1000,heightWithClip:Math.round((preview.bounds.max.y-Math.min(0,preview.bounds.min.y))*100)/100};
    const tile=Number(opt('size')??416);
    const views:View[]|undefined=opt('views')?.split(';').filter(Boolean).map(s=>{
      const [time,yaw,label]=s.split(',');return {time:Number(time),yaw:Number(yaw),label:label||undefined};
    });
    const sheetPath=opt('sheet')??`${stem}-sheet.webp`;
    const sheet=await preview.sheet({views,tile,capture:sheetPath});
    sheetInfo={path:relative(ROOT,resolve(TMP,sheetPath)),tiles:sheet.tiles};
  }catch(e:any){
    sheetInfo={error:String(e?.message??e)};
  }finally{await preview.dispose();}
  renderMs=performance.now()-r0;
}

const summary={
  ok:v.errors===0,
  glb:absInput.endsWith('.glb')?relative(ROOT,absInput):relative(ROOT,resolve(ROOT,opt('out')??resolve(TMP,`${stem}.glb`))),
  bytes:v.bytes,
  triangles:v.report.info?.totalTriangleCount??null,
  errors:v.errors,warnings:v.warnings,
  ...(issues.length?{issues}:{}),
  materials:v.materials.map((m:any)=>m.name),
  textures:v.textures.length,
  joints:v.skins[0]?.joints?.length??0,
  clips:v.clips.map(c=>({name:c.name,duration:Math.round(c.duration*1000)/1000})),
  ...(dims?{rest:dims}:{}),
  sheet:sheetInfo,
  ms:{build:Math.round(buildMs),validate:Math.round(validateMs),render:Math.round(renderMs)}
};
console.log(JSON.stringify(summary));
if(v.errors>0)process.exit(1);
