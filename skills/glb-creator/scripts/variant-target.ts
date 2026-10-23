export type VariantTarget={label:string;bytes:number;kind:'bytes'|'percent';value:number};
/** Decimal units; percentages are always relative to the unchanged input master. */
export function parseVariantTarget(value:string,masterBytes:number):VariantTarget{
  if(!Number.isSafeInteger(masterBytes)||masterBytes<=0)throw Error('Master byte count must be a positive safe integer');
  const text=value.trim(),match=text.match(/^(\d+(?:\.\d+)?)\s*(%|B|KB|MB|GB)$/i);
  if(!match)throw Error(`Invalid target ${value}; use 10MB,25MB,25%,50%`);
  const n=Number(match[1]),unit=match[2].toUpperCase();
  const bytes=Math.floor(unit==='%'?masterBytes*n/100:n*({B:1,KB:1e3,MB:1e6,GB:1e9}[unit]!));
  if(!Number.isFinite(n)||n<=0||!Number.isSafeInteger(bytes)||bytes<1)throw Error('Target must resolve to a positive safe byte count');
  return {label:text,bytes,kind:unit==='%'?'percent':'bytes',value:n};
}
