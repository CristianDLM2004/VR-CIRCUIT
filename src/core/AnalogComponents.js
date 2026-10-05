// Parámetros de modelos didácticos genéricos; no representan un fabricante. Hecho e implementado por LFTS
const field = (key, label, unit, value, min, max, step) => ({key,label,unit,value,min,max,step})
const current = () => field('maxCurrent','Corriente máxima','A',.2,.01,10,.01)
const voltage = () => field('maxVoltage','Tensión máxima','V',30,1,100,1)
const power = () => field('maxPower','Potencia máxima','W',.625,.025,50,.025)
const bipolar = label => ({label,pins:['collector','base','emitter'],fields:[field('beta','Ganancia beta','',100,10,500,10),current(),voltage(),power()]})
const mos = label => ({label,pins:['gate','drain','source'],fields:[field('threshold','Umbral |VGS|','V',2,.1,10,.1),field('onResistance','R encendido (*)','Ω',.2,.01,100,.01),current(),voltage(),field('maxGateVoltage','Máximo |VGS|','V',20,1,30,1),power()]})
export const ANALOG = {
 capacitor:{label:'Condensador',pins:['positive','negative'],fields:[field('capacitanceUF','Capacitancia','µF',1000,1,10000,1),field('maxVoltage','Tensión máxima','V',16,1,100,1)]},
 diode:{label:'Diodo',pins:['anode','cathode'],fields:[field('forwardVoltage','Caída directa','V',.7,.1,3,.05),current(),field('maxReverseVoltage','Máximo inverso','V',50,1,200,1),power()]},
 npn:bipolar('Transistor NPN'),pnp:bipolar('Transistor PNP'),nmos:mos('MOSFET N'),pmos:mos('MOSFET P'),
}
export const isAnalog = type => Object.hasOwn(ANALOG,type)
export function analogSettings(type,meta={}) {
 const values={}
 for(const f of ANALOG[type]?.fields||[]){const n=Number(meta[f.key]??f.value);values[f.key]=Number((Math.min(f.max,Math.max(f.min,Number.isFinite(n)?n:f.value))).toFixed(6))}
 return values
}
export function adjustAnalog(type,meta,key,steps){
 const values=analogSettings(type,meta),f=ANALOG[type]?.fields.find(x=>x.key===key)
 if(f)values[key]=Number(Math.min(f.max,Math.max(f.min,values[key]+f.step*steps)).toFixed(6))
 return values
}
