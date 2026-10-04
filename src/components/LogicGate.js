// Integrado DIP14 con pestaña de diagrama y pines para protoboard. Hecho e implementado por LFTS
import * as THREE from 'three'
import {gateDefinition,pinLabels} from '../core/LogicGates.js'
import {diagramCanvas} from './LogicGateDiagram.js'
export function createLogicGate(data){
 const kind=data.meta?.gate||'AND',def=gateDefinition(kind),labels=pinLabels(kind),root=new THREE.Group(),textures=[]
 const plastic=new THREE.MeshStandardMaterial({color:0x22262b,roughness:.65}),metal=new THREE.MeshStandardMaterial({color:0xaeb5c1,metalness:.7,roughness:.3})
 function box(w,h,d,x,y,z,m){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);root.add(o);return o}
 const body=box(.029,.018,.116,0,.014,0,plastic)
 const dot=new THREE.Mesh(new THREE.CylinderGeometry(.003,.003,.0008,16),new THREE.MeshBasicMaterial({color:0x5e6570}));dot.position.set(-.008,.0235,-.048);root.add(dot)
 const pins=[],insertionPins=[]
 for(let i=0;i<7;i++)for(const side of [-1,1]){const pin=side<0?i+1:14-i,z=-.045+i*.015,x=side*.021
   box(.009,.002,.005,side*.018,.010,z,metal);box(.002,.020,.005,x,.003,z,metal)
   pins.push({id:String(pin),label:pin+' '+labels[pin],localPos:new THREE.Vector3(x,.012,z)});insertionPins.push({id:String(pin),localPos:new THREE.Vector3(x,-.007,z)})
 }
 function texture(canvas){const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;textures.push(t);return t}
 function textCanvas(text){const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#e6edf4';ctx.font='bold 45px Arial';ctx.textAlign='center';ctx.fillText(text,256,85);return c}
 const label=new THREE.Mesh(new THREE.PlaneGeometry(.10,.023),new THREE.MeshBasicMaterial({map:texture(textCanvas(def.part+' '+kind)),transparent:true}));label.rotation.set(-Math.PI/2,0,Math.PI/2);label.position.y=.0235;root.add(label)
 const panel=new THREE.Mesh(new THREE.PlaneGeometry(.408,.306),new THREE.MeshBasicMaterial({map:texture(diagramCanvas(kind)),side:THREE.DoubleSide}));panel.position.set(0,.24,-.075);panel.rotation.x=-.18;root.add(panel)
 const openLabel=texture(textCanvas('Abrir diagrama')),closeLabel=texture(textCanvas('Cerrar diagrama'))
 const tab=box(.095,.025,.008,.070,.07,0,new THREE.MeshBasicMaterial({color:0x245e81}));const face=new THREE.Mesh(new THREE.PlaneGeometry(.090,.022),new THREE.MeshBasicMaterial({map:closeLabel,transparent:true}));face.position.z=.005;tab.add(face)
 tab.name='AlternarDiagrama';tab.userData.isUI=true;tab.userData.onPress=()=>{panel.visible=!panel.visible;face.material.map=panel.visible?closeLabel:openLabel;face.material.needsUpdate=true}
 const proxy=box(.052,.05,.125,0,.010,0,new THREE.MeshBasicMaterial({visible:false,colorWrite:false,depthWrite:false}))
 Object.assign(root.userData,{pins,insertionPins,insertionRows:'ef',insertionCount:14,logicButtons:[tab],logicState:{powered:false,outputs:{},inputs:{}},diagramPanel:panel,updateLogicPanel:camera=>{const target=camera.getWorldPosition(new THREE.Vector3());panel.lookAt(target);tab.lookAt(target)},
 grabTarget:proxy,grabRadius:.025,surfaceContactObject:body,surfaceUpright:true,
 getGrabCenterWorld:()=>root.localToWorld(new THREE.Vector3(0,.014,0)),getGrabWorldPoints:()=>[-.04,0,.04].map(z=>({weight:1,worldPos:root.localToWorld(new THREE.Vector3(0,.014,z))})),
 disposeLogic:()=>{textures.forEach(t=>t.dispose());root.traverse(o=>{o.geometry?.dispose();o.material?.dispose()})}})
 return root
}


