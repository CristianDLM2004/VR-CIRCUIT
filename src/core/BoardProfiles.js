// Perfiles eléctricos educativos; no representan límites certificados de hardware. Hecho e implementado por LFTS
import { UNO_GPIO, UNO_PWM, gpioName } from './ArduinoPins.js'
import { BLINK_SKETCH, ARDUINO_HELP } from './ArduinoSketch.js'
export const ESP_GPIO=[36,39,34,35,32,33,25,26,27,14,12,13,23,22,1,3,21,19,18,5,17,16,4,2,15]
export const ESP_ADC=[36,39,34,35,32,33,25,26,27,14,12,13,4,2,15]
export const ESP_INPUT_ONLY=[34,35,36,39]
export const ESP_LEFT=['EN','GPIO36','GPIO39','GPIO34','GPIO35','GPIO32','GPIO33','GPIO25','GPIO26','GPIO27','GPIO14','GPIO12','GPIO13','GND','VIN']
export const ESP_RIGHT=['GPIO23','GPIO22','GPIO1','GPIO3','GPIO21','GPIO19','GPIO18','GPIO5','GPIO17','GPIO16','GPIO4','GPIO2','GPIO15','GND2','3V3']
export const ESP_PINS=[...ESP_LEFT,...ESP_RIGHT]
export const UNO_PROFILE={type:'arduinoUno',name:'Arduino Uno',voltage:5,adcMax:1023,threshold:3,led:'D13',gpio:UNO_GPIO,pwm:UNO_PWM,inputOnly:[],pinName:gpioName,blink:BLINK_SKETCH,help:ARDUINO_HELP,intBits:16,constants:null,supplyLimits:[['5V',.5],['3V3',.05]],adcPin(pin){if(Number.isInteger(pin)&&pin>=0&&pin<=5)pin+=14;if(!Number.isInteger(pin)||pin<14||pin>19)throw Error('analogRead requiere A0–A5.');return gpioName(pin)}}
export const ESP_PROFILE={type:'esp32',name:'ESP32',voltage:3.3,adcMax:4095,threshold:2.5,led:'GPIO2',gpio:ESP_GPIO.map(n=>'GPIO'+n),pwm:ESP_GPIO.filter(n=>!ESP_INPUT_ONLY.includes(n)),inputOnly:ESP_INPUT_ONLY,intBits:32,constants:{HIGH:1,LOW:0,INPUT:0,OUTPUT:1,INPUT_PULLUP:2,LED_BUILTIN:2,true:1,false:0},
  blink:BLINK_SKETCH.replace('pin D13','GPIO2'),
  help:ARDUINO_HELP+' ESP32 educativo: GPIO de 3.3 V, ADC lineal ideal de 12 bits (0–4095), int de 32 bits. GPIO34/35/36/39 solo entrada y sin pull-up interno. LED_BUILTIN=2 en este modelo. Sin Wi-Fi, Bluetooth, paquetes externos, DAC, touch, I2C, SPI ni UART físico. EN y BOOT son decorativos. VIN representa la salida USB virtual de 5 V; no alimenta externamente la placa. Las alertas de corriente usan umbrales didácticos conservadores de 20 mA/pin y 200 mA total.',
  supplyLimits:[['VIN',.5],['3V3',.2]],
  pinName(pin){if(!Number.isInteger(pin)||!ESP_GPIO.includes(pin))throw Error('GPIO no disponible en este ESP32 de 30 pines.');return 'GPIO'+pin},
  adcPin(pin){if(!ESP_ADC.includes(pin))throw Error('GPIO sin ADC en este modelo ESP32.');return 'GPIO'+pin},
}
export const boardProfile=type=>type==='esp32'?ESP_PROFILE:UNO_PROFILE
export const isProgrammable=type=>type==='esp32'||type==='arduinoUno'
export function espNode(id,pin){return 'pin:'+id+':'+(pin==='GND2'?'GND':pin)}
export function espBranches(component,mesh){
  const state=mesh?.userData?.arduinoState,id=component.id,ground=espNode(id,'GND'),branches=[]
  const add=(suffix,a,b,values)=>branches.push({id:id+':'+suffix,a,b,component,type:'esp32',ownerId:id,closed:true,currentLimit:null,...values})
  function supply(pin,voltage,resistance){const internal='esp:'+id+':'+pin;add(pin+':source',internal,ground,{source:true,voltage});add(pin+':output',internal,espNode(id,pin),{resistance})}
  if(state?.powered){supply('VIN',5,.5);supply('3V3',3.3,1)}
  for(const pin of ESP_PROFILE.gpio){
    const mode=state?.modes[pin]??0
    if(state?.powered&&mode===1)supply(pin,state.outputs[pin]??0,25)
    else if(state?.powered&&mode===2)add(pin+':pullup',espNode(id,'3V3'),espNode(id,pin),{resistance:45000})
    add(pin+':sense',espNode(id,pin),ground,{resistance:1e9})
  }
  return branches
}
