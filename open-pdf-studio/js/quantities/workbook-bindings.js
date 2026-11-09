import {rekenOm} from './eenheid-omrekening.js';
import {cellAddress} from './workbook-adapter.js';
export const configSignature=schedule=>JSON.stringify(schedule?.config||{});
export function validateBinding(binding){
 if(!binding||binding.version!==1||!['id','name','sourcePath','scheduleId','scheduleName','workbookPath','sheet','config'].every(k=>typeof binding[k]==='string'&&binding[k].length>0))throw new Error('INVALID_BINDING');
 if(!Array.isArray(binding.mappings)||!binding.mappings.length||binding.mappings.length>1000)throw new Error('INVALID_BINDING');const used=new Set();
 for(const m of binding.mappings){cellAddress(m.cell);if(used.has(m.cell)||typeof m.field!=='string'||typeof m.unit!=='string')throw new Error('INVALID_MAPPING');used.add(m.cell);}
 return binding;
}
export function bindingStatus(binding,{document,schedule,workbookExists=true}={}){
 if(!workbookExists)return 'workbook-missing';if(!document||document.filePath!==binding.sourcePath)return 'source-unavailable';if(!schedule)return 'schedule-missing';if(schedule.name!==binding.scheduleName)return 'schedule-renamed';if(configSignature(schedule)!==binding.config)return 'schedule-changed';
 if(!binding.last)return 'never-refreshed';if(binding.last.documentId!==document.id||binding.last.revision!==(document.inhoudRevisie||0))return 'stale';return 'current';
}
export function bindingValues(binding,result,schedule){
 validateBinding(binding);if(schedule.id!==binding.scheduleId||schedule.name!==binding.scheduleName||configSignature(schedule)!==binding.config)throw new Error('REBIND_SCHEDULE');
 // De engine rekent elke cel al om naar de kolomeenheid; een cel die niet om te
 // rekenen was (lengte tegen oppervlakte, px naast mm) staat in foreignUnits en
 // ontbreekt in het totaal: dan weigeren in plaats van een half totaal te sturen.
 // Wijkt de kolomeenheid af van de eenheid van de koppeling (de meest gebruikte
 // eenheid verschoof), dan gaat het totaal exact om naar die van de koppeling.
 return binding.mappings.map(m=>{
  const column=result.columns.find(c=>c.key===m.field);if(!column||column.kind!=='number'||column.total===false)throw new Error('MISSING_NUMERIC_FIELD');
  for(const row of result.groups.flatMap(g=>g.rows)){if(row.foreignUnits&&m.field in row.foreignUnits)throw new Error('MIXED_UNITS');}
  const total=result.count===0?0:result.grandTotals[m.field];if(typeof total!=='number'||!Number.isFinite(total))throw new Error('TOTAL_UNAVAILABLE');
  const value=result.count===0?0:rekenOm(total,column.unit||'',m.unit);if(value==null)throw new Error('UNIT_CHANGED');
  return {sheet:binding.sheet,cell:m.cell,field:m.field,unit:m.unit,value};
 });
}
export function bindingCsv(binding,values,revision){const safe=v=>{let s=String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return ['cell,value,unit,source,schedule,revision',...values.map(m=>[safe(m.cell),String(m.value),safe(m.unit),safe(binding.sourcePath),safe(binding.scheduleName),safe(revision)].join(','))].join('\n');}
