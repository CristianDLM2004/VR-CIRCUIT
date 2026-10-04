// Hecho e implementado por LFTS
export const UNO_GPIO = Array.from({length:20},(_,i)=>i<14?"D"+i:"A"+(i-14))
export const UNO_PINS = [...UNO_GPIO,"5V","3V3","GND","GND2"]
export const UNO_PWM = [3,5,6,9,10,11]
export function gpioName(value) {
  if(!Number.isInteger(value)||value<0||value>19)throw Error("Pin inválido: usa 0–13 o A0–A5.")
  return UNO_GPIO[value]
}
export function unoNode(id,pin){return "pin:"+id+":"+(pin==="GND2"?"GND":pin)}

// Alimentación USB virtual y salidas con resistencia interna didáctica; PWM usa su valor medio. Hecho e implementado por LFTS
export function arduinoBranches(component, mesh) {
  const state=mesh?.userData?.arduinoState
  const id=component.id,ground=unoNode(id,"GND"),branches=[]
  const add=(suffix,a,b,values)=>branches.push({id:id+":"+suffix,a,b,component,type:"arduinoUno",ownerId:id,closed:true,currentLimit:null,...values})
  function supply(pin,voltage,resistance){
    const internal="uno:"+id+":"+pin
    add(pin+":source",internal,ground,{source:true,voltage})
    add(pin+":output",internal,unoNode(id,pin),{resistance})
  }
  if(state?.powered){
    supply("5V",5,0.5);supply("3V3",3.3,1)
  }
  for(const pin of UNO_GPIO){
    const mode=state?.modes[pin]??0
    if(state?.powered && mode===1)supply(pin,state.outputs[pin]??0,25)
    else if(state?.powered && mode===2)add(pin+":pullup",unoNode(id,"5V"),unoNode(id,pin),{resistance:30000})
    add(pin+":sense",unoNode(id,pin),ground,{resistance:1e9})
  }
  return branches
}
