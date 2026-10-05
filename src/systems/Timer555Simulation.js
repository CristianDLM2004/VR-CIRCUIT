// Subpasos limitados para el enclavamiento del 555 y la carga de condensadores. Hecho e implementado por LFTS
import {buildCircuit,solveCircuit} from './CircuitSolver.js'
import {settleLogic} from './LogicGateSimulation.js'
import {nextTimer555State} from '../core/Timer555.js'

export function simulateTimers(components,holes,sync,dt) {
  const timers=components.filter(c=>c.type==='timer555'),capacitors=components.filter(c=>c.type==='capacitor')
  const duration=Math.min(.033,Math.max(.0001,Number(dt)||1/90)),steps=Math.ceil(duration/.005),step=duration/steps
  const hasLogic=components.some(c=>c.type==='logicGate')
  let graph
  for(let i=0;i<steps;i++){
    for(const c of capacitors){const mesh=sync.getMeshById(c.id);if(mesh)mesh.userData.analogStep=step}
    graph=hasLogic?settleLogic(components,holes,sync):solveCircuit(buildCircuit(components,holes,sync))
    // Una sola integración por subpaso; no reavanzar carga al cambiar la salida. Hecho e implementado por LFTS
    for(const c of capacitors){const mesh=sync.getMeshById(c.id),r=graph.readings.get(c.id);if(mesh&&r&&!r.invalid&&Number.isFinite(r.voltage))mesh.userData.capacitorVoltage=r.voltage}
    for(const c of timers){
      const mesh=sync.getMeshById(c.id);if(!mesh)continue
      const next=nextTimer555State(c,mesh,graph),old=mesh.userData.timerState||{}
      const time=(old.elapsed||0)+step
      const changed=next.high!==!!old.high
      const interval=changed&&old.lastEdge!=null?time-old.lastEdge:old.interval
      mesh.userData.timerState={...next,elapsed:time,lastEdge:changed?time:old.lastEdge,interval}
    }
  }
  for(const c of timers){
    const state=sync.getMeshById(c.id)?.userData.timerState
    if(!state)continue
    graph.faults.push(...state.alerts)
    if(state.interval!=null&&state.interval<.025)graph.faults.push({ids:[c.id],message:'NE555N: temporización demasiado rápida para la resolución didáctica; aumenta R o C'})
  }
  return graph
}
