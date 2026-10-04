// Inserción simultánea de 30 pines a ambos lados del canal central. Hecho e implementado por LFTS
import * as THREE from 'three'
export function snapESP32(object,holeSystem,components,maxDist=.05){
  const pins=object?.userData?.insertionPins
  if(!holeSystem||pins?.length!==30)return null
  holeSystem.updateWorldPositions();object.updateWorldMatrix(true,false)
  const board=holeSystem.protoboardGroup
  if(!board)return null
  board.updateWorldMatrix(true,false)
  const occupied=new Set()
  for(const c of components||[])if(c.id!==object.userData.componentId&&c.inserted)for(const h of Object.values(c.pinConnections||{}))occupied.add(h)
  const holes=holeSystem.holes.filter(h=>/^[dg]\d+$/.test(h.id))
  const normal=new THREE.Vector3(0,1,0).applyQuaternion(board.getWorldQuaternion(new THREE.Quaternion()))
  const currentQ=object.getWorldQuaternion(new THREE.Quaternion()),scale=object.getWorldScale(new THREE.Vector3())
  const worldPins=pins.map(p=>object.localToWorld(p.localPos.clone()))
  let best=null,bestScore=Infinity
  for(const yaw of [-Math.PI/2,Math.PI/2]){
    const q=board.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw))
    if(currentQ.angleTo(q)>Math.PI/4)continue
    const offsets=pins.map(p=>p.localPos.clone().multiply(scale).applyQuaternion(q))
    for(const first of holes){
      const origin=first.worldPos.clone().addScaledVector(normal,-.004).sub(offsets[0])
      const matches={},used=new Set();let score=0,valid=true
      for(let i=0;i<pins.length;i++){
        const tip=origin.clone().add(offsets[i]),surface=tip.clone().addScaledVector(normal,.004)
        if(tip.distanceTo(worldPins[i])>maxDist){valid=false;break}
        const hole=holes.find(h=>h.worldPos.distanceToSquared(surface)<1e-8)
        if(!hole||occupied.has(hole.id)||used.has(hole.id)){valid=false;break}
        matches[pins[i].id]=hole.id;used.add(hole.id);score+=tip.distanceToSquared(worldPins[i])
      }
      if(valid&&score<bestScore){bestScore=score;best={position:origin,quaternion:q,pinConnections:matches}}
    }
  }
  return best
}
