// Modelo educativo inspirado en Arduino Uno R3. Hecho e implementado por LFTS
import * as THREE from "three"
import { UNO_PWM } from "../core/ArduinoPins.js"

export function createArduinoUno() {
  const root = new THREE.Group(), textures = []
  root.name = "ArduinoUno"
  const mat = (color, metalness = 0, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, metalness, roughness })
  const pcb = mat(0x086784), black = mat(0x171b20), metal = mat(0xb5bbc1, 0.8, 0.3), gold = mat(0xbda664, 0.65), dark = mat(0x05080b)
  function mesh(geometry, material, x, y, z) {
    const item = new THREE.Mesh(geometry, material)
    item.position.set(x, y, z); root.add(item); return item
  }
  const box = (w,h,d,x,y,z,m) => mesh(new THREE.BoxGeometry(w,h,d),m,x,y,z)
  const cylinder = (r,h,x,y,z,m) => mesh(new THREE.CylinderGeometry(r,r,h,20),m,x,y,z)
  function label(text,x,z,w=0.028,h=0.006,y=0.004,color="#e6eeea") {
    const canvas=document.createElement("canvas"); canvas.width=512; canvas.height=128
    const ctx=canvas.getContext("2d"); ctx.fillStyle=color; ctx.font="bold 64px monospace"; ctx.textAlign="center"; ctx.fillText(text,256,86)
    const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace; textures.push(texture)
    const face=mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}),x,y,z)
    face.rotation.x=-Math.PI/2; return face
  }
  // Contorno y taladros reales de la placa, con anillos metalizados. Hecho e implementado por LFTS
  const outline=new THREE.Shape()
  const points=[[-.11,-.085],[.098,-.085],[.098,-.061],[.11,-.047],[.11,.064],[.098,.085],[-.11,.085]]
  points.forEach(([x,z],i)=>i?outline.lineTo(x,-z):outline.moveTo(x,-z)); outline.closePath()
  const holes=[[-.100,-.071],[-.068,.074],[.101,-.030],[.099,.062]]
  for(const [x,z] of holes){const hole=new THREE.Path();hole.absarc(x,-z,.0047,0,Math.PI*2,true);outline.holes.push(hole)}
  const geometry=new THREE.ExtrudeGeometry(outline,{depth:.003,bevelEnabled:false,curveSegments:24}); geometry.rotateX(-Math.PI/2)
  const board=mesh(geometry,pcb,0,0,0)
  for(const [x,z] of holes){const ring=mesh(new THREE.RingGeometry(.0047,.0067,24),metal,x,.0032,z);ring.rotation.x=-Math.PI/2}
  // Pistas impresas y vías agrupadas para reducir llamadas de dibujo en XR. Hecho e implementado por LFTS
  const traceVertices=[]
  function trace(points){for(let i=1;i<points.length;i++)traceVertices.push(points[i-1][0],.0033,points[i-1][1],points[i][0],.0033,points[i][1])}
  for(let i=0;i<19;i++){
    const x=-.052+i*.007
    trace([[x,-.074],[x,-.053+i%3*.003],[x-.012,-.041+i%3*.003],[x-.012,.008],[.013+i*.003,.022]])
  }
  for(let i=0;i<12;i++)trace([[-.081+i*.006,.073],[-.081+i*.006,.059],[-.073+i*.006,.051],[-.073+i*.006,.039]])
  const traces=new THREE.BufferGeometry();traces.setAttribute("position",new THREE.Float32BufferAttribute(traceVertices,3))
  root.add(new THREE.LineSegments(traces,new THREE.LineBasicMaterial({color:0x218ca1})))
  for(let i=0;i<28;i++){const x=-.087+(i%14)*.013,z=i<14?-.033:.056;cylinder(.0011,.0003,x,.0035,z,gold);cylinder(.0005,.0004,x,.0037,z,dark)}
  // Conectores hembra con cavidad visible y contactos interiores. Hecho e implementado por LFTS
  const pins=[]
  function header(ids,start,z){
    const pitch=.0082,w=ids.length*pitch+.001
    box(w,.009,.010,start+(ids.length-1)*pitch/2,.0075,z,black)
    ids.forEach((id,i)=>{
      const x=start+i*pitch
      box(.0054,.0005,.0054,x,.0122,z,dark)
      box(.001,.0006,.0037,x-.0021,.0125,z,gold)
      const display=id?.startsWith("D")?(UNO_PWM.includes(Number(id.slice(1)))?"~":"")+id.slice(1):id
      label(display||"",x,z+(z<0?.012:-.011),.009,.0045)
      if(id&&!["IOREF","RESET","VIN","AREF","SDA","SCL"].includes(id))pins.push({id,label:id,localPos:new THREE.Vector3(x,.0128,z)})
    })
  }
  header(["SCL","SDA","AREF","GND2","D13","D12","D11","D10","D9","D8"],-.060,-.077)
  header(["D7","D6","D5","D4","D3","D2","D1","D0"],.027,-.077)
  header(["IOREF","RESET","3V3","5V","GND","VIN"],-.061,.077)
  header(["A0","A1","A2","A3","A4","A5"],.032,.077)
  label("DIGITAL (PWM ~)",.015,-.053,.080,.006)
  label("POWER",-.041,.058,.028,.006);label("ANALOG IN",.052,.058,.045,.006)
  // ATmega328P, zócalo y sus 28 patillas. Hecho e implementado por LFTS
  box(.090,.004,.030,.033,.006,.030,black)
  box(.086,.007,.024,.033,.011,.030,mat(0x24272a))
  for(let i=0;i<14;i++)for(const side of [-1,1])box(.003,.005,.005,-.006+i*.006,.008,.030+side*.014,metal)
  label("ATMEGA328P-PU",.035,.028,.070,.006,.0146,"#929994")
  label("ATMEL",.035,.035,.030,.004,.0146,"#929994")
  cylinder(.003,.0004,-.001,.0148,.030,dark)
  // Puerto USB tipo B con boca hueca, aislante y cuatro contactos. Hecho e implementado por LFTS
  box(.031,.024,.034,-.104,.016,-.045,metal)
  box(.0006,.018,.026,-.1198,.016,-.045,dark)
  box(.001,.010,.018,-.1202,.014,-.045,mat(0xa5a29a))
  for(let i=0;i<4;i++)box(.0013,.002,.002,-.121,.017,-.051+i*.004,gold)
  for(const z of [-.060,-.030])box(.018,.002,.004,-.100,.0045,z,metal)
  // Jack de alimentación, condensadores y cristal de cuarzo. Hecho e implementado por LFTS
  box(.030,.010,.024,-.102,.008,.058,black)
  const barrel=cylinder(.012,.030,-.105,.019,.058,black);barrel.rotation.z=Math.PI/2
  const opening=cylinder(.0085,.0007,-.1204,.019,.058,dark);opening.rotation.z=Math.PI/2
  const contact=cylinder(.002,.004,-.1208,.019,.058,metal);contact.rotation.z=Math.PI/2
  for(const x of [-.075,-.052]){
    cylinder(.0085,.018,x,.012,.053,black);cylinder(.0078,.0007,x,.0215,.053,metal)
    label("47µF",x,.051,.013,.0035,.022);label("25V",x,.055,.010,.003,.022)
  }
  const crystal=box(.028,.005,.011,-.054,.006,.013,metal)
  label("16.000",crystal.position.x,.013,.023,.004,.0088,"#4d5559")
  // Microcontrolador USB, reguladores, resistencias y condensadores SMD. Hecho e implementado por LFTS
  box(.017,.003,.017,-.046,.005,-.030,black)
  for(let i=0;i<6;i++)for(const s of [-1,1]){
    box(.001,.001,.003,-.052+i*.0024,.0048,-.030+s*.010,metal)
    box(.003,.001,.001,-.046+s*.010,.0048,-.036+i*.0024,metal)
  }
  for(let i=0;i<26;i++){
    const x=-.083+(i%7)*.009,z=-.010+Math.floor(i/7)*.009
    if(z>.007&&x>-.07)continue
    box(.005,.002,.0025,x,.0045,z,i%3?mat(0xa78d65):black)
    for(const s of [-1,1])box(.001,.0021,.0026,x+s*.0025,.0045,z,metal)
  }
  box(.012,.003,.015,-.088,.005,.027,black);box(.008,.001,.012,-.096,.004,.027,metal)
  // Reset e ICSP decorativos; conservan el alcance eléctrico de la propuesta. Hecho e implementado por LFTS
  box(.014,.004,.012,-.094,.006,-.072,metal);cylinder(.0045,.003,-.094,.0095,-.072,mat(0xbc3639))
  label("RESET",-.094,-.061,.019,.004)
  for(const [cx,cz] of [[-.065,-.059],[.093,.026]]){
    box(.014,.003,.020,cx,.005,cz,black)
    for(let row=0;row<3;row++)for(let col=0;col<2;col++)box(.002,.012,.002,cx+(col-.5)*.007,.012,cz+(row-1)*.007,gold)
    label("ICSP",cx,cz+.015,.019,.004)
  }
  label("ARDUINO",.032,-.025,.052,.009)
  label("UNO",.043,-.009,.037,.014)
  label("R3",.070,-.008,.014,.006)
  label("MADE FOR LEARNING",.031,.005,.068,.004)
  const led=box(.004,.002,.0025,-.021,.005,-.044,mat(0x9b7522))
  label("L",-.028,-.044,.004,.004)
  for(const [text,x,z,color] of [["TX",-.040,-.047,0xb19635],["RX",-.040,-.054,0xb19635],["ON",.083,-.019,0x409857]]){
    box(.004,.002,.0025,x,.005,z,mat(color));label(text,x+.009,z,.011,.004)
  }
  root.userData.updateArduinoLed=on=>{led.material.emissive.setHex(on?0xffb520:0);led.material.emissiveIntensity=on?2:0}
  // Controles de simulación separados de la serigrafía de la placa. Hecho e implementado por LFTS
  const buttons=[]
  for(const [i,action] of ["Código","Ejecutar","Detener"].entries()){
    const button=box(.056,.008,.019,-.061+i*.061,.006,.105,mat(0x203948))
    button.attach(label(action,button.position.x,.105,.049,.008,.0105))
    button.userData.isUI=true;button.userData.arduinoAction=action;buttons.push(button)
  }
  const proxy=mesh(new THREE.BoxGeometry(.24,.041,.176),new THREE.MeshBasicMaterial({visible:false,depthWrite:false,colorWrite:false}),-.005,.016,0)
  Object.assign(root.userData,{
    pins,arduinoButtons:buttons,grabTarget:proxy,grabRadius:.025,surfaceContactObject:board,surfaceUpright:true,
    getGrabCenterWorld:()=>root.localToWorld(new THREE.Vector3(0,.012,0)),
    getGrabWorldPoints:()=>[-.085,0,.085].map(x=>({weight:1,worldPos:root.localToWorld(new THREE.Vector3(x,.012,0))})),
    arduinoState:{powered:false,modes:{},outputs:{}},
    disposeArduino:()=>{for(const t of textures)t.dispose();root.traverse(o=>{o.geometry?.dispose();o.material?.dispose()})},
  })
  return root
}
