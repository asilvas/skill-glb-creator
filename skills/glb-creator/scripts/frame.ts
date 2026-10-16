import { TMP } from './paths';
import { resolve } from 'node:path';
// Transport to an image-capable tool over stdout; base64 never needs to enter model context.
const receipt=await Bun.file(resolve(TMP,'preview-server.json')).json();
const opts={time:Number(process.argv[2]??0),yaw:Number(process.argv[3]??Math.atan2(6,10)),size:Number(process.argv[4]??256),format:'webp'};
const response=await fetch(`${receipt.url}/frame`,{method:'POST',body:JSON.stringify(opts)});
if(!response.ok)throw Error(await response.text());
console.log(JSON.stringify({mime:response.headers.get('Content-Type'),base64:Buffer.from(await response.arrayBuffer()).toString('base64'),renderMs:response.headers.get('X-Render-Ms')}));
