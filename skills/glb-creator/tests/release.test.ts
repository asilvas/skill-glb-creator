import {test,expect} from 'bun:test';
import * as T from 'three';
import * as API from '../scripts/index';
import {AssetReviewViewer} from '../scripts/review-viewer';
import {Preview} from '../scripts/preview';
import {resolve} from 'node:path';

test('installed package exposes production delivery/review APIs at version2.1.0',async()=>{
 const p=await Bun.file(resolve(import.meta.dir,'../package.json')).json();expect(p.version).toBe('2.1.0');
 for(const name of['generateVariants','optimizeVariants','createReview','serveReview','decodeForInspection','createQualityEvaluator','compareQualityFrames'])expect(typeof (API as any)[name]).toBe('function');expect(typeof AssetReviewViewer).toBe('function');
 for(const name of['./variants','./optimize','./review','./review-viewer','./decode','./quality-metric'])expect(await Bun.file(resolve(import.meta.dir,'..',p.exports[name])).exists()).toBe(true);
 for(const name of['./surface','./projection','./canonicalize','./rig','./rig-external','./multiview'])expect(p.exports[name]).toBeUndefined();
});

test('absolute preview sampling covers arbitrary clip inventory, true non-loop endpoints and rest restoration without a renderer',async()=>{
 const preview=new Preview(),root=new T.Group(),bone=new T.Object3D();bone.name='marker';root.add(bone);preview.asset=root;preview.scene.add(root);preview.mixer=new T.AnimationMixer(root);
 preview.animations=Array.from({length:7},(_,i)=>new T.AnimationClip('clip-'+i,1,[new T.VectorKeyframeTrack('marker.position',[0,1],[0,0,0,i+1,0,0])]));preview.clips=preview.animations.map(c=>({name:c.name,duration:c.duration}));expect(preview.defaultViews().length).toBe(3+7*3);
 for(let i=0;i<7;i++){preview.setClip(i);preview.applyPose(1);expect(bone.position.x).toBe(i+1);preview.applyPose(.25);expect(bone.position.x).toBeCloseTo((i+1)*.25);preview.applyPose(3);expect(bone.position.x).toBe(i+1);}
 preview.setClip('clip-4');preview.applyPose(.5);expect(bone.position.x).toBeCloseTo(2.5);preview.setClip(false);expect(bone.position.x).toBe(0);expect(()=>preview.setClip('missing')).toThrow('Unknown animation');expect(()=>preview.applyPose(NaN)).toThrow('Invalid');await preview.dispose();expect(preview.animations).toEqual([]);expect(preview.clips).toEqual([]);
});
