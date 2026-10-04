// Pinouts de encapsulados DIP14 y lógica de tres estados. Hecho e implementado por LFTS
const common=[[1,2,3],[4,5,6],[9,10,8],[12,13,11]]
export const GATES={
 NAND:{part:'74LS00',channels:common,formula:'Y = ¬(A · B)',fn:(a,b)=>1-(a&b)},
 AND:{part:'74LS08',channels:common,formula:'Y = A · B',fn:(a,b)=>a&b},
 OR:{part:'74LS32',channels:common,formula:'Y = A + B',fn:(a,b)=>a|b},
 NOR:{part:'74LS02',channels:[[2,3,1],[5,6,4],[8,9,10],[11,12,13]],formula:'Y = ¬(A + B)',fn:(a,b)=>1-(a|b)},
 NOT:{part:'74LS04',channels:[[1,2],[3,4],[5,6],[9,8],[11,10],[13,12]],formula:'Y = ¬A',fn:a=>1-a},
 XOR:{part:'74LS86',channels:common,formula:'Y = A ⊕ B',fn:(a,b)=>a^b},
 XNOR:{part:'CD74HC7266',channels:[[1,2,3],[5,6,4],[8,9,10],[12,13,11]],formula:'Y = ¬(A ⊕ B)',fn:(a,b)=>1-(a^b),cmos:true},
}
export const gateDefinition=kind=>GATES[kind]||GATES.AND
export function gateValue(kind,inputs){
 const def=gateDefinition(kind),combinations=inputs.reduce((all,v)=>all.flatMap(a=>(v==null?[0,1]:[v]).map(b=>[...a,b])),[[]])
 const answers=new Set(combinations.map(args=>def.fn(...args)));return answers.size===1?[...answers][0]:null
}
export function pinLabels(kind){const d=gateDefinition(kind),out={7:'GND',14:'VCC'};d.channels.forEach((c,i)=>{c.slice(0,-1).forEach((p,j)=>out[p]=(j?'B':'A')+(i+1));out[c.at(-1)]='Y'+(i+1)});return out}
export function logicNode(id,pin){return 'pin:'+id+':'+pin}
export function logicBranches(c,mesh){
 const def=gateDefinition(c.meta?.gate),state=mesh?.userData.logicState,branches=[],node=p=>logicNode(c.id,p)
 const add=(suffix,a,b,r,role)=>branches.push({id:c.id+':'+suffix,a,b,resistance:r,closed:true,type:'logicGate',ownerId:c.id,component:c,logicRole:role})
 add('supply',node(14),node(7),1e9,'sense')
 for(const channel of def.channels){
   for(const p of channel.slice(0,-1))add('sense:'+p,node(p),node(7),1e9,'sense')
   const out=channel.at(-1),value=state?.outputs?.[out]
   if(state?.powered&&value!=null)add('output:'+out,node(out),node(value?14:7),value?100:25,'driver')
 }
 return branches
}
