// NE555 bipolar: pinout DIP8 y modelo funcional didáctico. Hecho e implementado por LFTS
export const TIMER555_PINS = {1:'GND',2:'TRIG',3:'OUT',4:'RESET',5:'CONT',6:'THRES',7:'DISCH',8:'VCC'}
export const timerNode = (id,pin) => `pin:${id}:${pin}`

export function timer555Branches(component,mesh) {
  const id=component.id,node=pin=>timerNode(id,pin),state=mesh?.userData.timerState,branches=[]
  const add=(suffix,a,b,resistance,role='internal',offset=0)=>branches.push({
    id:id+':'+suffix,a,b,resistance,offset,closed:true,type:'timer555',ownerId:id,component,timerRole:role,
  })
  // La red de tres resistencias permite variar ambos umbrales desde CONT. Hecho e implementado por LFTS
  const reference=`internal:${id}:trigger-reference`
  add('divider-top',node(8),node(5),5000)
  add('divider-middle',node(5),reference,5000)
  add('divider-bottom',reference,node(1),5000)
  add('supply',node(8),node(1),5000,'sense')
  for(const pin of [2,3,4,5,6,7])add('sense:'+pin,node(pin),node(1),1e9,'sense')
  if(state?.powered){
    // Aproximación de salida bipolar, no rail a rail; sin fuentes internas de energía. Hecho e implementado por LFTS
    add('output',node(3),node(state.high?8:1),state.high?50:20,'driver',state.high?-1.2:0)
    if(!state.high)add('discharge',node(7),node(1),10,'discharge')
  }
  return branches
}

export function nextTimer555State(component,mesh,graph) {
  const id=component.id,old=mesh?.userData.timerState||{},reading=suffix=>graph.readings.get(id+':'+suffix)
  const supply=reading('supply'),vcc=supply?.voltage??0
  const network=new Map()
  for(const b of graph.branches){
    if(!b.closed||b.resistance>=1e8||(b.ownerId===id&&b.timerRole!=='contact'))continue
    for(const [a,z] of [[b.a,b.b],[b.b,b.a]]){if(!network.has(a))network.set(a,[]);network.get(a).push(z)}
  }
  function connected(pin){
    const start=timerNode(id,pin),targets=new Set(graph.sources.flatMap(s=>[s.a,s.b])),seen=new Set([start]),queue=[start]
    for(let i=0;i<queue.length;i++){if(targets.has(queue[i]))return true;for(const n of network.get(queue[i])||[])if(!seen.has(n)){seen.add(n);queue.push(n)}}
    return false
  }
  const alerts=[],add=message=>alerts.push({ids:[id],message:'NE555N: '+message})
  const powered=!!supply&&!supply.invalid&&supply.powered&&vcc>=4.5&&vcc<=16&&connected(8)&&connected(1)
  const sense=pin=>reading('sense:'+pin)?.voltage
  const trigger=sense(2),reset=sense(4),threshold=sense(6),control=sense(5)
  let high=!!old.high
  if(!powered){high=false;add('conecta VCC (8) y GND (1), entre 4.5 y 16 V')}
  else {
    const missing=[2,4,6].filter(pin=>!connected(pin))
    if(missing.length){high=false;add('entrada sin conectar: '+missing.map(p=>p+' '+TIMER555_PINS[p]).join(', '))}
    else if(reset<.7)high=false
    else if(!Number.isFinite(control)||control<=.1||control>=vcc){high=false;add('voltaje de control (5) fuera del rango del modelo')}
    else if(trigger<control/2-1e-7)high=true
    else if(threshold>control+1e-7)high=false
    for(const pin of [2,4,5,6,7]){const value=sense(pin);if(Number.isFinite(value)&&(value<-.3||value>vcc+.3))add('tensión fuera de alimentación en pin '+pin)}
  }
  for(const [suffix,limit,label] of [['output',.2,'salida (3)'],['discharge',.1,'descarga (7)']]){
    const r=reading(suffix);if(r&&!r.invalid&&Math.abs(r.currentA)>limit)add(label+' supera '+limit+' A; riesgo de daño')
  }
  return {powered,high,voltage:vcc,trigger,threshold,control,alerts}
}
