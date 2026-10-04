// ESP32 DevKit de 30 pines, ampliado para interacción XR. Hecho e implementado por LFTS
import * as THREE from 'three'
import { ESP_LEFT, ESP_RIGHT } from '../core/BoardProfiles.js'
export function createESP32(){
  const root=new THREE.Group(),textures=[];root.name='ESP32 DevKit'
  const material=(color,metalness=0,roughness=.6)=>new THREE.MeshStandardMaterial({color,metalness,roughness})
  const black=material(0x16191d),metal=material(0xbfc6ce,.75,.28),gold=material(0xb99c50,.65),pcb=material(0x20282a),white=material(0xbac5c7),dark=material(0x030607)
  function mesh(g,m,x,y,z){const o=new THREE.Mesh(g,m);o.position.set(x,y,z);root.add(o);return o}
  const box=(w,h,d,x,y,z,m)=>mesh(new THREE.BoxGeometry(w,h,d),m,x,y,z)
  const cylinder=(r,h,x,y,z,m)=>mesh(new THREE.CylinderGeometry(r,r,h,16),m,x,y,z)
  function label(text,x,z,w=.025,h=.005,y=.0033){
    const c=document.createElement('canvas');c.width=512;c.height=128
    const ctx=c.getContext('2d');ctx.fillStyle='#e7e9e5';ctx.font='bold 60px monospace';ctx.textAlign='center';ctx.fillText(text,256,85)
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;textures.push(t)
    const o=mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false}),x,y,z);o.rotation.x=-Math.PI/2;return o
  }
  // Placa de 9 × 24 cm con cuatro taladros pasantes. Hecho e implementado por LFTS
  const shape=new THREE.Shape();shape.moveTo(-.04,-.09);shape.lineTo(.04,-.09);shape.quadraticCurveTo(.045,-.09,.045,-.085);shape.lineTo(.045,.085);shape.quadraticCurveTo(.045,.09,.04,.09);shape.lineTo(-.04,.09);shape.quadraticCurveTo(-.045,.09,-.045,.085);shape.lineTo(-.045,-.085);shape.quadraticCurveTo(-.045,-.09,-.04,-.09)
  for(const x of [-.035,.035])for(const z of [-.08,.08]){const h=new THREE.Path();h.absarc(x,-z,.004,0,Math.PI*2,true);shape.holes.push(h);const r=mesh(new THREE.RingGeometry(.004,.0057,20),metal,x,.0032,z);r.rotation.x=-Math.PI/2}
  const g=new THREE.ExtrudeGeometry(shape,{depth:.003,bevelEnabled:false});g.rotateX(-Math.PI/2)
  const board=mesh(g,pcb,0,0,0)
  // Módulo WROOM, blindaje y antena serpenteante. Hecho e implementado por LFTS
  box(.058,.002,.082,0,.004,-.039,black)
  box(.055,.008,.057,0,.009,-.026,metal)
  label('ESP-WROOM-32',0,-.040,.048,.007,.0132)
  label('ESPRESSIF',0,-.028,.041,.006,.0132)
  label('Wi-Fi / BT',0,-.016,.036,.005,.0132)
  label('MODELO EDUCATIVO',0,-.006,.048,.004,.0132)
  cylinder(.0014,.0005,-.020,.0135,-.005,dark)
  const antenna=[]
  for(let i=0;i<7;i++){const x=-.024+i*.008;antenna.push(x,.0053,-.079+(i%2)*.015);if(i<6)antenna.push(x+.008,.0053,-.079+(i%2)*.015)}
  const ag=new THREE.BufferGeometry();ag.setAttribute('position',new THREE.Float32BufferAttribute(antenna,3));root.add(new THREE.Line(ag,new THREE.LineBasicMaterial({color:0xb8aa73})))
  for(let i=0;i<12;i++)for(const side of [-1,1])box(.002,.001,.003,side*.029,.005,-.052+i*.005,gold)
  // Headers, agujeros de conexión y nombres acordes al pinout de referencia. Hecho e implementado por LFTS
  const pins=[],insertionPins=[]
  for(const [side,ids] of [[-1,ESP_LEFT],[1,ESP_RIGHT]])ids.forEach((id,i)=>{
    const x=side*.036,z=-.07875+i*.01125
    box(.009,.006,.009,x,.006,z,black);box(.005,.0004,.005,x,.0093,z,gold);box(.003,.0005,.003,x,.0096,z,dark)
    box(.0017,.008,.0017,x,-.003,z,gold)
    const title=id==='GND2'?'GND':id.replace('GPIO','')
    label(title,x-side*.009,z,.010,.0037)
    insertionPins.push({id,localPos:new THREE.Vector3(x,-.007,z*4/3)})
    if(id!=='EN')pins.push({id,label:id,localPos:new THREE.Vector3(x,.010,z*4/3)})
  })
  // Conversor USB, regulador y componentes SMD. Hecho e implementado por LFTS
  box(.019,.003,.022,0,.005,.033,black);label('CP2102',0,.033,.018,.004,.0067)
  for(let i=0;i<7;i++)for(const side of [-1,1])box(.003,.001,.001,side*.0105,.004,.024+i*.003,metal)
  box(.014,.004,.016,-.022,.005,.047,black);box(.016,.001,.005,-.022,.004,.037,metal)
  for(let i=0;i<20;i++){
    const x=i<10?-.023:.023,z=.008+(i%10)*.006
    box(.006,.002,.003,x,.0045,z,i%3?white:black)
    for(const side of [-1,1])box(.001,.0022,.003,x+side*.003,.0045,z,metal)
  }
  const tv=[]
  for(let i=0;i<12;i++){const x=-.026+i*.0047;tv.push(x,.0031,.003,x,.0031,.018,x,.0031,.018,x*.5,.0031,.023)}
  const tg=new THREE.BufferGeometry();tg.setAttribute('position',new THREE.Float32BufferAttribute(tv,3));root.add(new THREE.LineSegments(tg,new THREE.LineBasicMaterial({color:0x405953})))
  // Micro USB frontal con boca y contactos; EN y BOOT solo visuales. Hecho e implementado por LFTS
  box(.026,.010,.019,0,.008,.084,metal);box(.021,.006,.0005,0,.008,.0938,dark)
  box(.015,.0015,.001,0,.006,.0942,black)
  for(let i=0;i<5;i++)box(.001,.001,.001,-.006+i*.003,.007,.0948,gold)
  for(const [x,name] of [[-.022,'EN'],[.022,'BOOT']]){box(.011,.003,.010,x,.005,.078,metal);cylinder(.0035,.002,x,.0075,.078,black);label(name,x,.068,.015,.004)}
  const led=box(.004,.0015,.003,.010,.004,.058,material(0x243e69))
  box(.004,.0015,.003,-.010,.004,.058,material(0x623127));label('D2',.010,.063,.010,.0035);label('PWR',-.010,.063,.014,.0035)
  root.userData.updateArduinoLed=on=>{led.material.emissive.setHex(on?0x2288ff:0);led.material.emissiveIntensity=on?2:0}
  // Controles independientes del circuito impreso. Hecho e implementado por LFTS
  const buttons=[]
  for(const [i,action] of ['Código','Ejecutar','Detener'].entries()){
    const b=box(.043,.008,.021,(i-1)*.047,.005,.112,material(0x294655));b.attach(label(action,b.position.x,.112,.039,.006,.0095))
    b.userData.isUI=true;b.userData.arduinoAction=action;buttons.push(b)
  }
  const proxy=box(.098,.04,.19,0,.008,0,new THREE.MeshBasicMaterial({visible:false,colorWrite:false,depthWrite:false}))
  Object.assign(root.userData,{pins,insertionPins,arduinoButtons:buttons,grabTarget:proxy,grabRadius:.025,surfaceContactObject:board,surfaceUpright:true,
    getGrabCenterWorld:()=>root.localToWorld(new THREE.Vector3(0,.008,0)),
    getGrabWorldPoints:()=>[-.06,0,.06].map(z=>({weight:1,worldPos:root.localToWorld(new THREE.Vector3(0,.008,z))})),
    arduinoState:{powered:false,modes:{},outputs:{}},
    disposeArduino:()=>{textures.forEach(t=>t.dispose());root.traverse(o=>{o.geometry?.dispose();o.material?.dispose()})}})
  // Adaptar el paso longitudinal a los agujeros de 15 mm del simulador. Hecho e implementado por LFTS
  for(const child of root.children){child.position.z*=4/3;child.scale.z*=4/3}
  return root
}
