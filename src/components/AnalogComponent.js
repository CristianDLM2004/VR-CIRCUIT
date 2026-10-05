// Modelos con terminales separados 15 mm para la escala de esta protoboard. Hecho e implementado por LFTS
import * as THREE from 'three'
import {ANALOG,analogSettings} from '../core/AnalogComponents.js'
export function createAnalogComponent(data){
 const root=new THREE.Group(),type=data.type,def=ANALOG[type],textures=[]
 const mat=(color,metalness=0)=>new THREE.MeshStandardMaterial({color,metalness,roughness:.4})
 const metal=mat(0xbac3cb,.75),plastic=mat(type==='capacitor'?0x1767ad:0x25272b)
 function box(w,h,d,x,y,z,m){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);mesh.position.set(x,y,z);root.add(mesh);return mesh}
 const mos=type==='nmos'||type==='pmos',diode=type==='diode',cap=type==='capacitor'
 let body
 if(cap||diode){body=new THREE.Mesh(new THREE.CylinderGeometry(cap?.019:.009,cap?.019:.009,cap?.044:.028,24),plastic);body.position.y=cap?.04:.029;if(diode)body.rotation.z=Math.PI/2;root.add(body)}
 else body=box(mos?.045:.038,mos?.041:.026,.016,0,mos?.041:.034,0,plastic)
 if(cap){const lid=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.001,24),metal);lid.position.y=.0625;root.add(lid);box(.028,.0005,.001,0,.0633,0,plastic);box(.001,.0005,.028,0,.0633,0,plastic);box(.004,.035,.001,.013,.040,.014,metal)}
 if(diode){const band=new THREE.Mesh(new THREE.CylinderGeometry(.0092,.0092,.004,24),metal);band.rotation.z=Math.PI/2;band.position.set(.010,.029,0);root.add(band)}
 if(mos){const tab=box(.032,.019,.003,0,.070,-.006,metal);const screw=new THREE.Mesh(new THREE.CylinderGeometry(.004,.004,.0035,16),mat(0x151719));screw.rotation.x=Math.PI/2;screw.position.set(0,.072,-.006);root.add(screw)}
 const pins=def.pins.map((id,i)=>{const x=(i-(def.pins.length-1)/2)*.015;box(.0018,.025,.002,x,.008,0,metal);return {id,label:({positive:'+',negative:'−',anode:'A',cathode:'K',collector:'C',base:'B',emitter:'E',gate:'G',drain:'D',source:'S'})[id],localPos:new THREE.Vector3(x,-.0045,0)}})
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture)
 const label=new THREE.Mesh(new THREE.PlaneGeometry(.047,.0235),new THREE.MeshBasicMaterial({map:texture,transparent:true}));label.position.set(0,.042,cap?.020:.009);root.add(label)
 const updateAnalogLabel=meta=>{const p=analogSettings(type,meta),ctx=canvas.getContext('2d');ctx.clearRect(0,0,512,256);ctx.fillStyle='#f4f6fa';ctx.textAlign='center';ctx.font='bold 55px Arial';ctx.fillText(cap?p.capacitanceUF+' µF':diode?'DIODO':type.toUpperCase(),256,72);ctx.font='40px Arial';ctx.fillText(cap?p.maxVoltage+' V':diode?p.forwardVoltage+' V':mos?'Vth '+p.threshold+' V':'β '+p.beta,256,139);ctx.fillText(pins.map(p=>p.label).join('     '),256,222);texture.needsUpdate=true}
 updateAnalogLabel(data.meta)
 const proxy=box(.052,.076,.046,0,.032,0,new THREE.MeshBasicMaterial({visible:false,colorWrite:false,depthWrite:false}))
 // Anclas accesibles sobre la placa; las puntas mecánicas entran en los agujeros. Hecho e implementado por LFTS
 const insertionPins=pins.map(p=>({...p,localPos:p.localPos.clone()}))
 pins.forEach(p=>{p.localPos.y=.012})
 Object.assign(root.userData,{pins,insertionPins,insertionCount:pins.length,insertionRows:'abcdefghij',insertionYaws:[0,Math.PI],analogComponent:true,
 grabTarget:proxy,grabRadius:.028,surfaceContactObject:body,surfaceUpright:true,updateAnalogLabel,
 getGrabCenterWorld:()=>root.localToWorld(new THREE.Vector3(0,.034,0)),getGrabWorldPoints:()=>[-.012,0,.012].map(x=>({weight:1,worldPos:root.localToWorld(new THREE.Vector3(x,.034,0))})),
 disposeAnalog:()=>{textures.forEach(t=>t.dispose());root.traverse(o=>{o.geometry?.dispose();o.material?.dispose()})}})
 return root
}
