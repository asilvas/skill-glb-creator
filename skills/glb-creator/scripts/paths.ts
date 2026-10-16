import {resolve} from 'node:path';
export const ROOT=resolve(import.meta.dir,'..');
export const TMP=resolve(process.env.GLB_CREATOR_TMP??resolve(ROOT,'tmp'));
