// Resolución DC iterativa de compuertas; sin retardos de propagación físicos. Hecho e implementado por LFTS
import {buildCircuit,solveCircuit} from './CircuitSolver.js'
import {gateDefinition,gateValue,logicNode} from '../core/LogicGates.js'
export function settleLogic(components,holes,sync){
 const chips=components.filter(c=>c.type==='logicGate'),alerts=[]
 let graph,stable=false
 for(let iteration=0;iteration<32;iteration++){
   graph=solveCircuit(buildCircuit(components,holes,sync));let changed=false
   const adjacency=new Map()
   for(const b of graph.branches){if(!b.closed||b.logicRole==='sense'||b.resistance>=1e8)continue;for(const [a,z] of [[b.a,b.b],[b.b,b.a]]){if(!adjacency.has(a))adjacency.set(a,[]);adjacency.get(a).push(z)}}
   function connected(start,targets){const seen=new Set([start]),todo=[start];while(todo.length){const n=todo.pop();if(targets.includes(n))return true;for(const z of adjacency.get(n)||[])if(!seen.has(z)){seen.add(z);todo.push(z)}}return false}
   for(const c of chips){
     const mesh=sync.getMeshById(c.id);if(!mesh)continue
     const def=gateDefinition(c.meta?.gate),r=graph.readings.get(c.id+':supply'),v=r?.voltage
     const powered=!!r&&!r.invalid&&r.powered&&v>=(def.cmos?2:4.75)&&v<=(def.cmos?6:5.25)
     const outputs={},inputs={}
     for(const channel of def.channels){
       for(const pin of channel.slice(0,-1)){
         const reading=graph.readings.get(c.id+':sense:'+pin),value=reading?.voltage
         const wired=connected(logicNode(c.id,pin),[logicNode(c.id,7),logicNode(c.id,14)])
         inputs[pin]=powered&&wired&&reading&&!reading.invalid&&value>=-.3&&value<=v+.3?(value<=(def.cmos?.3*v:.8)?0:value>=(def.cmos?.7*v:2)?1:null):null
       }
       outputs[channel.at(-1)]=powered?gateValue(c.meta?.gate,channel.slice(0,-1).map(p=>inputs[p])):null
     }
     const before=mesh.userData.logicState||{}
     if(JSON.stringify([before.powered,before.outputs])!==JSON.stringify([powered,outputs]))changed=true
     mesh.userData.logicState={powered,outputs,inputs,voltage:v??0}
   }
   if(!changed){stable=true;break}
 }
 if(!stable){
   for(const c of chips){const m=sync.getMeshById(c.id);if(m)m.userData.logicState={powered:false,outputs:{},inputs:{},voltage:0};alerts.push({ids:[c.id],message:'Compuertas: red inestable o realimentación sin resolver'})}
   graph=solveCircuit(buildCircuit(components,holes,sync))
 }
 for(const c of chips){const state=sync.getMeshById(c.id)?.userData.logicState;if(!state)continue;const def=gateDefinition(c.meta?.gate),name=c.meta?.gate+' '+def.part
   if(!state.powered)alerts.push({ids:[c.id],message:name+': conecta VCC (14) y GND (7) con alimentación válida'})
   else if(Object.values(state.inputs).some(v=>v==null))alerts.push({ids:[c.id],message:name+': entradas flotantes o nivel lógico indefinido'})
   for(const ch of def.channels){const r=graph.readings.get(c.id+':output:'+ch.at(-1));if(r&&!r.invalid&&Math.abs(r.currentA)>.008)alerts.push({ids:[c.id],message:name+': salida sobre 8 mA (umbral didáctico)'})}
 }
 graph.faults.push(...alerts);return graph
}
