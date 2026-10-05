// Aproximaciones educativas: unión por tramos, BJT Ebers-Moll linealizado y MOS cuadrático. Hecho e implementado por LFTS
import {ANALOG,analogSettings} from '../core/AnalogComponents.js'
export function analogBranches(c,pinNode,mesh){
 const p=analogSettings(c.type,c.meta),n=id=>pinNode(c,id)
 const base={id:c.id,type:c.type,component:c,closed:true,params:p}
 if(c.type==='capacitor')return [{...base,a:n('positive'),b:n('negative'),resistance:(mesh?.userData?.analogStep||1/90)/(p.capacitanceUF*1e-6),offset:mesh?.userData?.capacitorVoltage||0}]
 if(c.type==='diode')return [{...base,a:n('anode'),b:n('cathode'),vf:p.forwardVoltage,resistance:1}]
 const positive=c.type==='pnp'||c.type==='pmos',bjt=c.type==='npn'||c.type==='pnp'
 const output=n(bjt?'collector':'drain'),reference=n(bjt?'emitter':'source'),control=n(bjt?'base':'gate')
 const a=positive?reference:output,b=positive?output:reference,ca=positive?reference:control,cb=positive?control:reference
 return [{...base,a,b,controlA:ca,controlB:cb,model:bjt?'bjt':'mos'},
 {...base,id:c.id+':control',ownerId:c.id,a:ca,b:cb,outputA:a,outputB:b,model:bjt?'base':'gate'}]
}
function current(b,v){
 const voltage=v(b.a)-v(b.b)
 if(!b.closed)return voltage*1e-10
 if(b.model==='gate')return voltage*1e-10
 if(b.model==='bjt'||b.model==='base'){
   const u=b.model==='base'?voltage:v(b.controlA)-v(b.controlB)
   const ce=b.model==='base'?v(b.outputA)-v(b.outputB):voltage
   const forward=Math.max(0,u-.65)/.5,reverse=Math.max(0,u-ce-.65)/.5,alpha=b.params.beta/(b.params.beta+1)
   return b.model==='base'?(1-alpha)*forward+.5*reverse:alpha*forward-reverse
 }
 if(b.model==='mos'){
   const overdrive=Math.max(0,v(b.controlA)-v(b.controlB)-b.params.threshold)
   const ds=Math.max(0,voltage),k=1/(2*b.params.onResistance)
   const channel=ds<overdrive?k*(overdrive*ds-.5*ds*ds):.5*k*overdrive*overdrive
   return channel-Math.max(0,-voltage-.7)+voltage*1e-10
 }
 if(b.type==='diode'||b.type==='led')return Math.max(0,voltage-b.vf)/(b.resistance||1)+voltage*1e-10
 return (voltage-(b.offset||0))/b.resistance
}
// Newton con búsqueda de paso: conserva las leyes de nodos incluso al saturar. Hecho e implementado por LFTS
export function solveAnalogIsland(branches,nodes,linearSolve){
 const sources=branches.filter(b=>b.source),ground=sources[0]?.b||branches[0].b
 const ids=[...nodes].filter(n=>n!==ground),index=new Map(ids.map((n,i)=>[n,i])),size=ids.length+sources.length
 let x=new Float64Array(size)
 function assemble(values,jacobian){
   const residual=new Float64Array(size),m=jacobian?Array.from({length:size},()=>new Float64Array(size)):null
   const v=n=>n===ground?0:values[index.get(n)]
   for(let i=0;i<ids.length;i++){residual[i]+=values[i]*1e-12;if(m)m[i][i]+=1e-12}
   for(const b of branches){
     if(b.source)continue
     const i=index.get(b.a),j=index.get(b.b),flow=current(b,v)
     if(i!==undefined)residual[i]+=flow
     if(j!==undefined)residual[j]-=flow
     if(m)for(const n of new Set([b.a,b.b,b.controlA,b.controlB,b.outputA,b.outputB].filter(Boolean))){
       const col=index.get(n);if(col===undefined)continue
       const delta=1e-6,derivative=(current(b,k=>v(k)+(k===n?delta:0))-flow)/delta
       if(i!==undefined)m[i][col]+=derivative
       if(j!==undefined)m[j][col]-=derivative
     }
   }
   sources.forEach((s,k)=>{const row=ids.length+k,a=index.get(s.a),b=index.get(s.b)
     residual[row]=v(s.a)-v(s.b)-s.voltage
     if(a!==undefined){residual[a]+=values[row];if(m){m[a][row]+=1;m[row][a]+=1}}
     if(b!==undefined){residual[b]-=values[row];if(m){m[b][row]-=1;m[row][b]-=1}}
   })
   return {residual,m,norm:Math.max(0,...Array.from(residual,Math.abs))}
 }
 for(let iteration=0;iteration<160;iteration++){
   const state=assemble(x,true)
   if(state.norm<1e-8){const v=n=>n===ground?0:x[index.get(n)],currents=new Map();sources.forEach((s,k)=>currents.set(s.id,-x[ids.length+k]));for(const b of branches)if(!b.source)currents.set(b.id,current(b,v));return {voltages:new Map([...nodes].map(n=>[n,v(n)])),currents}}
   const delta=linearSolve(state.m,Float64Array.from(state.residual,r=>-r))
   if(!delta)return {error:'Red analógica indeterminada: revisa las fuentes y conexiones'}
   let step=1,trial
   for(let attempt=0;attempt<24;attempt++){trial=Float64Array.from(x,(value,i)=>value+step*delta[i]);if(assemble(trial,false).norm<state.norm)break;step*=.5}
   x=trial
 }
 return {error:'El circuito analógico no convergió; revisa sus conexiones y valores'}
}
export function analogFaults(graph){
 const faults=[]
 for(const b of graph.branches){
   if(!ANALOG[b.type]||b.ownerId)continue
   const r=graph.readings.get(b.id),control=graph.readings.get(b.id+':control'),p=b.params
   if(!r||r.invalid)continue
   const add=message=>faults.push({ids:[b.id],message:ANALOG[b.type].label+': '+message})
   if(p.maxCurrent&&Math.max(Math.abs(r.currentA),Math.abs(control?.currentA||0))>p.maxCurrent+1e-7)add('sobrecorriente; supera '+p.maxCurrent+' A')
   if(p.maxVoltage&&Math.abs(r.voltage)>p.maxVoltage+1e-7)add('sobretensión; supera '+p.maxVoltage+' V')
   if(p.maxPower&&r.powerW+(control?.powerW||0)>p.maxPower+1e-7)add('sobrepotencia; supera '+p.maxPower+' W')
   if(b.type==='capacitor'&&r.voltage<-.1)add('polaridad invertida; riesgo de daño')
   if(b.type==='diode'&&-r.voltage>p.maxReverseVoltage)add('tensión inversa excesiva; riesgo de daño')
   if(p.maxGateVoltage&&Math.abs(control?.voltage||0)>p.maxGateVoltage)add('tensión de puerta excesiva; riesgo de daño')
 }
 return faults
}
