// Encapsulado DIP8 escalado a la protoboard y diagrama funcional propio. Hecho e implementado por LFTS
import * as THREE from 'three'
import {TIMER555_PINS} from '../core/Timer555.js'

export function timer555DiagramCanvas() {
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=768
  const ctx=canvas.getContext('2d')
  ctx.fillStyle='#eef5f8';ctx.fillRect(0,0,1024,768)
  const text=(s,x,y,size=28,color='#233b49')=>{ctx.fillStyle=color;ctx.font=`${size>=32?'bold ':''}${size}px Arial`;ctx.textAlign='center';ctx.fillText(s,x,y)}
  const line=(x,y,a,b,color='#496777')=>{ctx.strokeStyle=color;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(a,b);ctx.stroke()}
  const block=(x,y,w,h,label)=>{ctx.fillStyle='#d9e8ee';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#668899';ctx.lineWidth=3;ctx.strokeRect(x,y,w,h);text(label,x+w/2,y+h/2+9,25)}
  text('NE555N · Temporizador',512,53,40)
  text('Vista superior · Muesca hacia arriba',512,93,25)
  ctx.fillStyle='#252b32';ctx.fillRect(365,120,295,298)
  ctx.strokeStyle='#ced9df';ctx.lineWidth=5;ctx.beginPath();ctx.arc(512,120,27,0,Math.PI);ctx.stroke()
  ctx.fillStyle='#a2aeb8';ctx.beginPath();ctx.arc(390,145,7,0,Math.PI*2);ctx.fill()
  text('NE555N',512,260,40,'#f6f7f8');text('DIP8',512,305,27,'#bccbd5')
  for(let i=0;i<4;i++){
    const y=172+i*65,left=i+1,right=8-i
    ctx.fillStyle='#a3b1bb';ctx.fillRect(322,y-23,43,43);ctx.fillRect(660,y-23,43,43)
    text(String(left),343,y+9,27);text(String(right),681,y+9,27)
    text(TIMER555_PINS[left],205,y+9,29);text(TIMER555_PINS[right],823,y+9,29)
  }
  text('Interior: comparadores, memoria y descarga',512,470,30)
  block(35,502,240,65,'TRIG < CONT / 2');block(35,596,240,65,'THRES > CONT')
  block(371,535,156,100,'Memoria');text('S / R',449,623,23)
  line(275,534,371,560);line(275,628,371,605)
  block(628,518,195,65,'Salida (3)');line(527,560,628,551)
  block(628,615,320,65,'Descarga (7) → GND');line(527,602,628,649)
  text('RESET (4) tiene prioridad',227,708,25)
  text('Sin CONT externo: umbrales ⅓ y ⅔ de VCC',512,750,25)
  return canvas
}

export function createTimer555() {
  const root=new THREE.Group(),textures=[]
  const plastic=new THREE.MeshStandardMaterial({color:0x22252b,roughness:.66}),metal=new THREE.MeshStandardMaterial({color:0xb6bdc5,roughness:.3,metalness:.75})
  function box(w,h,d,x,y,z,material){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);o.position.set(x,y,z);root.add(o);return o}
  const body=box(.029,.018,.068,0,.014,0,plastic)
  const notch=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.0007,24),new THREE.MeshBasicMaterial({color:0x101317}));notch.position.set(0,.0235,-.033);root.add(notch)
  const dot=new THREE.Mesh(new THREE.CylinderGeometry(.002,.002,.0007,16),new THREE.MeshBasicMaterial({color:0x99a0a6}));dot.position.set(-.008,.0235,-.024);root.add(dot)
  const pins=[],insertionPins=[]
  for(let i=0;i<4;i++)for(const side of [-1,1]){
    const pin=side<0?i+1:8-i,x=side*.021,z=-.0225+i*.015
    box(.009,.002,.005,side*.018,.010,z,metal);box(.002,.020,.005,x,.003,z,metal)
    pins.push({id:String(pin),label:pin+' '+TIMER555_PINS[pin],localPos:new THREE.Vector3(x,.012,z)})
    insertionPins.push({id:String(pin),localPos:new THREE.Vector3(x,-.007,z)})
  }
  const texture=canvas=>{const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;textures.push(t);return t}
  function labelCanvas(text){const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#ecf1f5';ctx.textAlign='center';ctx.font='bold 44px Arial';ctx.fillText(text,256,85);return c}
  const label=new THREE.Mesh(new THREE.PlaneGeometry(.047,.017),new THREE.MeshBasicMaterial({map:texture(labelCanvas('NE555N')),transparent:true}));label.rotation.set(-Math.PI/2,0,Math.PI/2);label.position.y=.0236;root.add(label)
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(.34,.255),new THREE.MeshBasicMaterial({map:texture(timer555DiagramCanvas()),side:THREE.DoubleSide}));panel.position.set(0,.22,-.06);root.add(panel)
  const open=texture(labelCanvas('Abrir diagrama')),close=texture(labelCanvas('Cerrar diagrama'))
  const tab=box(.095,.025,.008,.066,.065,0,new THREE.MeshBasicMaterial({color:0x246f86}))
  const face=new THREE.Mesh(new THREE.PlaneGeometry(.09,.022),new THREE.MeshBasicMaterial({map:close,transparent:true}));face.position.z=.0045;tab.add(face)
  tab.name='DiagramaNE555';tab.userData.isUI=true;tab.userData.onPress=()=>{panel.visible=!panel.visible;face.material.map=panel.visible?close:open;face.material.needsUpdate=true}
  const proxy=box(.052,.046,.074,0,.012,0,new THREE.MeshBasicMaterial({visible:false,colorWrite:false,depthWrite:false}))
  Object.assign(root.userData,{pins,insertionPins,insertionRows:'ef',insertionCount:8,logicButtons:[tab],diagramPanel:panel,timerState:{powered:false,high:false},
    grabTarget:proxy,grabRadius:.026,surfaceContactObject:body,surfaceUpright:true,
    getGrabCenterWorld:()=>root.localToWorld(new THREE.Vector3(0,.014,0)),getGrabWorldPoints:()=>[-.02,0,.02].map(z=>({weight:1,worldPos:root.localToWorld(new THREE.Vector3(0,.014,z))})),
    updateLogicPanel:camera=>{const target=camera.getWorldPosition(new THREE.Vector3());panel.lookAt(target);tab.lookAt(target)},
    disposeLogic:()=>{textures.forEach(t=>t.dispose());root.traverse(o=>{o.geometry?.dispose();o.material?.dispose()})},
  })
  return root
}
