import {test,expect} from 'bun:test';
import {Asset} from '../scripts/geometry';
import {assetIO} from '../scripts/io';
import {parseVariantTarget,generateVariants,transformVariantCandidate} from '../scripts/variants';
import {adaptiveProfile} from '../scripts/optimize-search';
import {decodeForInspection} from '../scripts/decode';
import {validate} from '../scripts/validate';
import {join} from 'node:path';
import {mkdtempSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function fixture(){const a=new Asset();a.joint('root',[0,0,0]);a.joint('arm',[.5,1,0],'root');const pixels=new Uint8Array(32*32*4);for(let i=0;i<pixels.length;i+=4)pixels.set([138+(i%7),67,31,255],i);a.surfaces.set('skin',{baseColor:await sharp(pixels,{raw:{width:32,height:32,channels:4}}).png().toBuffer(),normal:await sharp({create:{width:16,height:16,channels:3,background:'#8080ff'}}).png().toBuffer()});a.ell('skin',[0,1,0],[.5,1,.5],'root');a.ell('skin',[.5,1,0],[.2,.7,.2],'arm');for(const name of['idle','attack','wave']){const c=a.doc.createAnimation(name);a.channel(c,'arm',[0,.5,1],[[0,0,0],[.5,0,0],[0,0,0]]);}return a.bytes();}
test('arbitrary decimal budgets and percentages always refer to immutable master bytes',()=>{
 expect(parseVariantTarget('10MB',80_000_000).bytes).toBe(10_000_000);expect(parseVariantTarget('25%',80_000_000).bytes).toBe(20_000_000);expect(parseVariantTarget('50%',80_000_000).bytes).toBe(40_000_000);expect(parseVariantTarget('1.5 MB',80_000_000).bytes).toBe(1_500_000);for(const s of['0MB','-1MB','NaNMB','1','.5MB','0%','Infinity%'])expect(()=>parseVariantTarget(s,100)).toThrow();expect(()=>parseVariantTarget('1MB',0)).toThrow();
});
test('all requested budgets share adaptive measurements and retain source bytes plus every clip',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'glb-v21-budgets-')),master=join(folder,'master.glb'),bytes=await fixture();await Bun.write(master,bytes);let measured=0;const r=await generateVariants(master,{outDir:join(folder,'out'),targets:['50%','1B','200%','1.5MB','75%'],maxEvaluations:8,evaluator:{protocol:{testOnly:true},async evaluate(){measured++;return{valid:true,retention:1};}}});
 expect(r.strategy).toBe('auto');expect(r.variants.length).toBe(5);expect(r.attempts.length).toBe(8);expect(measured).toBeGreaterThan(1);expect(r.variants[1].status).toBe('unmet');expect(r.variants[2].status).toBe('met');for(const [i,v]of r.variants.entries()){expect(v.target.bytes).toBe(parseVariantTarget(['50%','1B','200%','1.5MB','75%'][i],bytes.length).bytes);expect(v.inventory.clips.map(c=>c.name)).toEqual(['idle','attack','wave']);expect(v.resolvedAtSeconds).toBeLessThanOrEqual(r.totalSeconds);}expect(hash(await Bun.file(master).bytes())).toBe(hash(bytes));expect(hash(await Bun.file(r.master.preservedPath).bytes())).toBe(hash(bytes));
 await expect(generateVariants(master,{outDir:join(folder,'out'),targets:['50%'],maxEvaluations:4,evaluator:{async evaluate(){return{valid:true,retention:1};}}})).rejects.toThrow('overwrite');const bad=join(folder,'legacy');await expect(generateVariants(master,{outDir:bad,strategy:'texture' as any,targets:['50%']})).rejects.toThrow('Only adaptive');expect(existsSync(bad)).toBe(false);
},60000);
test('lossless candidate and codec inspection retain full skin/clips and exact texture pixels',async()=>{
 const bytes=await fixture(),built=await transformVariantCandidate(bytes,adaptiveProfile(1,1,100,false));expect(built.attempt.lossless).toBe(true);expect(built.attempt.semanticInvariant).toBe(true);expect(built.attempt.textures.every(t=>t.pixelsExact===true)).toBe(true);expect(built.attempt.decodedValidation.errors).toBe(0);const folder=mkdtempSync(join(tmpdir(),'glb-v21-decode-')),input=join(folder,'delivery.glb'),output=join(folder,'inspection.glb');await Bun.write(input,built.bytes);await decodeForInspection(input,output);const io=await assetIO(),d=await io.read(output);expect(d.getRoot().listAnimations().map(a=>a.getName())).toEqual(['idle','attack','wave']);expect(d.getRoot().listSkins()[0].listJoints().map(j=>j.getName())).toEqual(['root','arm']);expect(d.getRoot().listExtensionsUsed().some(e=>e.extensionName==='EXT_meshopt_compression')).toBe(false);expect(d.getRoot().listTextures().every(t=>['image/png','image/jpeg'].includes(t.getMimeType()))).toBe(true);expect(hash(await Bun.file(input).bytes())).toBe(hash(built.bytes));await expect(decodeForInspection(input,input)).rejects.toThrow('new inspection');await expect(decodeForInspection(input,output)).rejects.toThrow('new inspection');
},60000);
test('public validation reads an actual Meshopt and WebP delivery with its full clip/skin/material inventory',async()=>{
 const master=await fixture(),built=await transformVariantCandidate(master,adaptiveProfile(1,1,100,false)),report=await validate(built.bytes);expect(built.attempt.inventory.extensions).toContain('EXT_meshopt_compression');expect(built.attempt.inventory.extensions).toContain('EXT_texture_webp');expect(report.errors).toBe(0);expect(report.bytes).toBe(built.bytes.length);expect(report.clips.map(c=>c.name)).toEqual(['idle','attack','wave']);expect(report.skins[0].joints).toEqual(['root','arm']);expect(report.materials.some(m=>m.baseColor)).toBe(true);expect(report.textures.length).toBeGreaterThan(0);expect(report.textures.every(t=>t.mime==='image/webp')).toBe(true);expect(report.sha256).toBe(hash(built.bytes));
},60000);
