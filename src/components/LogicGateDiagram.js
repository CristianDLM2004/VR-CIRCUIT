// Símbolos y diagrama funcional: cada canal comparte el mismo pinout que la simulación. Hecho e implementado por LFTS
import {gateDefinition,pinLabels} from '../core/LogicGates.js'
export function drawGate(ctx,kind,x,y,size=1){
 ctx.save();ctx.translate(x,y);ctx.scale(size,size);ctx.lineWidth=3;ctx.strokeStyle='#152e44';ctx.fillStyle='#ffffff'
 const neg=['NAND','NOR','NOT','XNOR'].includes(kind),or=['OR','NOR','XOR','XNOR'].includes(kind)
 ctx.beginPath()
 if(kind==='NOT'){ctx.moveTo(-30,-27);ctx.lineTo(28,0);ctx.lineTo(-30,27);ctx.closePath()}
 else if(or){ctx.moveTo(-34,-28);ctx.bezierCurveTo(2,-28,23,-20,39,0);ctx.bezierCurveTo(23,20,2,28,-34,28);ctx.quadraticCurveTo(-12,0,-34,-28)}
 else{ctx.moveTo(-30,-28);ctx.lineTo(0,-28);ctx.bezierCurveTo(43,-28,43,28,0,28);ctx.lineTo(-30,28);ctx.closePath()}
 ctx.fill();ctx.stroke()
 if(['XOR','XNOR'].includes(kind)){ctx.beginPath();ctx.moveTo(-43,-28);ctx.quadraticCurveTo(-21,0,-43,28);ctx.stroke()}
 if(neg){ctx.beginPath();ctx.arc(kind==='NOT'?35:or?46:38,0,6,0,Math.PI*2);ctx.fill();ctx.stroke()}
 ctx.restore()
}
export function diagramCanvas(kind){
 const def=gateDefinition(kind),labels=pinLabels(kind),c=document.createElement('canvas');c.width=1200;c.height=900;const ctx=c.getContext('2d')
 ctx.fillStyle='#f4f8fc';ctx.fillRect(0,0,1200,900);ctx.textAlign='center';ctx.fillStyle='#133449';ctx.font='bold 42px Arial';ctx.fillText(kind+' · '+def.part,600,52)
 ctx.font='23px Arial';ctx.fillText('Vista superior · '+def.channels.length+' compuertas independientes · VCC 14 / GND 7',600,90)
 ctx.strokeStyle='#345065';ctx.lineWidth=3;ctx.strokeRect(90,180,1020,340)
 ctx.beginPath();ctx.arc(90,350,24,-Math.PI/2,Math.PI/2);ctx.stroke()
 const terminal={}
 for(let i=0;i<7;i++)for(const top of [false,true]){const pin=top?14-i:i+1,x=155+i*148,y=top?180:520;terminal[pin]={x,y};ctx.strokeRect(x-22,top?140:520,44,40);ctx.fillStyle='#133449';ctx.font='bold 23px Arial';ctx.fillText(pin,x,top?169:548);ctx.font='20px Arial';ctx.fillStyle=pin===14?'#218245':pin===7?'#525e68':'#1261a2';ctx.fillText(labels[pin],x,top?126:585)}
 const half=def.channels.length/2
 def.channels.forEach((ch,i)=>{
   const top=i>=half,index=top?def.channels.length-1-i:i,x=250+index*(700/Math.max(1,half-1)),y=top?265:435
   drawGate(ctx,kind,x,y,1)
   ctx.font='18px Arial';ctx.fillStyle='#496270';ctx.fillText('G'+(i+1),x,y+42)
   const portY=ch.length===2?[0]:[-12,12]
   ch.slice(0,-1).forEach((pin,j)=>{const t=terminal[pin],py=y+portY[j],px=x-(["OR","NOR","XOR","XNOR"].includes(kind)?27:30);ctx.strokeStyle='#2771a6';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(t.x,t.y);ctx.lineTo(t.x,py);ctx.lineTo(px,py);ctx.stroke()})
   const t=terminal[ch.at(-1)];ctx.strokeStyle='#d4832a';ctx.beginPath();ctx.moveTo(x+({AND:32,NAND:44,OR:39,NOR:52,NOT:41,XOR:39,XNOR:52}[kind]),y);ctx.lineTo(t.x,y);ctx.lineTo(t.x,t.y);ctx.stroke()
 })
 ctx.fillStyle='#133449';ctx.font='bold 27px Arial';ctx.fillText(def.formula,320,654);ctx.fillText('Tabla de verdad',850,640)
 ctx.font='24px monospace';ctx.fillText(kind==='NOT'?'A │ Y':'A B │ Y',850,680)
 const rows=kind==='NOT'?[[0],[1]]:[[0,0],[0,1],[1,0],[1,1]];rows.forEach((row,i)=>ctx.fillText(row.join(' ')+' │ '+def.fn(...row),850,720+i*32))
 ctx.font='22px Arial';ctx.fillText('Modelo educativo DC',315,710);ctx.fillText(def.cmos?'VCC: 2–6 V · niveles CMOS':'VCC: 4.75–5.25 V · niveles TTL',315,747);ctx.fillText('X = entrada sin definir',315,784)
 ctx.font='19px Arial';ctx.fillStyle='#526574';ctx.fillText('Conecta las entradas no utilizadas a un nivel definido. Diagrama lógico, no transistor por transistor.',600,874)
 return c
}

