import { boardProfile, isProgrammable } from "../core/BoardProfiles.js"
// Hecho e implementado por LFTS
import * as THREE from "three"
import { ArduinoSketch, compileSketch, BLINK_SKETCH } from "../core/ArduinoSketch.js"
import { UNO_GPIO, UNO_PWM, gpioName } from "../core/ArduinoPins.js"
import { ArduinoEditor } from "../components/ArduinoEditor.js"

export class ArduinoSystem {
  constructor(scene, appState, sync, interaction) {
    Object.assign(this,{scene,appState,sync,interaction})
    this.runtimes=new Map();this.alerts=[];this.editor=new ArduinoEditor(this)
  }
  component(id){return this.appState.components.find(c=>c.id===id&&isProgrammable(c.type))}
  verify(source){return compileSketch(source)}
  profile(id){return boardProfile(this.component(id)?.type)}
  spawn(position,type="arduinoUno"){
    if(!isProgrammable(type))throw Error("Tipo de placa no compatible")
    const id=crypto.randomUUID(),p=position
    this.appState.addComponent({id,type,meta:{source:boardProfile(type).blink},
      transform:{x:p.x,y:p.y,z:p.z,qx:0,qy:0,qz:0,qw:1}})
    this.interaction.tryPlaceObjectDirectly(this.sync.addMeshFromComponent(this.component(id)))
    return id
  }
  register(root){
    if(!isProgrammable(root.userData.componentType))return
    for(const button of root.userData.arduinoButtons){
      button.userData.onPress=()=>{
        const id=root.userData.componentId
        if(button.userData.arduinoAction==="Código")this.editor.open(id)
        else if(button.userData.arduinoAction==="Ejecutar")this.run(id)
        else this.stop(id)
      }
      this.interaction.register(button)
    }
  }
  unregister(root){
    if(!isProgrammable(root.userData.componentType))return
    const id=root.userData.componentId
    this.stop(id);this.runtimes.delete(id)
    for(const button of root.userData.arduinoButtons||[])this.interaction.unregister(button)
    if(this.editor.id===id)this.editor.close()
  }
  stop(id){
    this.runtimes.get(id)?.stop()
    const state=this.sync.getMeshById(id)?.userData.arduinoState
    if(state){state.powered=false;state.outputs={};state.modes={}}
    this.sync.getMeshById(id)?.userData.updateArduinoLed(false)
    if(this.editor.id===id)this.editor.message("Detenido · USB virtual desconectado")
  }
  run(id){
    const c=this.component(id),mesh=this.sync.getMeshById(id);if(!c||!mesh)return
    this.stop(id)
    const state=mesh.userData.arduinoState={powered:false,modes:{},outputs:{},inputs:{},serial:""}
    try{
      const runtime=new ArduinoSketch(c.meta?.source??this.profile(id).blink,{constants:this.profile(id).constants,intBits:this.profile(id).intBits,call:(name,args)=>this.call(state,name,args,this.profile(id))})
      this.runtimes.set(id,runtime);state.powered=true
      if(this.editor.id===id)this.editor.message("")
    }catch(error){
      this.runtimes.set(id,{running:false,error:error.message,stop(){}})
      if(this.editor.id===id)this.editor.message(error.message)
    }
  }
  call(state,name,args,profile=boardProfile("arduinoUno")){
    if(name.startsWith("Serial.")){
      if(name==="Serial.begin"){if(!Number.isFinite(args[0])||args[0]<=0)throw Error("Baudrate inválido.");return 0}
      state.serial=(state.serial+String(args[0])+(name==="Serial.println"?"\n":"")).slice(-4000);return 0
    }
    if(args.some(v=>typeof v!=="number"||!Number.isFinite(v)))throw Error("Argumento numérico inválido en "+name)
    let pin=args[0]
    if(name==="analogRead"){
      return Math.round(Math.max(0,Math.min(profile.voltage,state.inputs[profile.adcPin(pin)]??0))*profile.adcMax/profile.voltage)
    }
    const id=profile.pinName(pin)
    if(profile.inputOnly.includes(pin)&&(["digitalWrite","analogWrite"].includes(name)||(name==="pinMode"&&args[1]!==0)))throw Error("GPIO"+pin+": solo entrada, sin pull-up interno.")
    if(name==="pinMode"){
      if(![0,1,2].includes(args[1]))throw Error("pinMode requiere INPUT, OUTPUT o INPUT_PULLUP.")
      state.modes[id]=args[1];return 0
    }
    if(name==="digitalWrite"){
      if(![0,1].includes(args[1]))throw Error("digitalWrite requiere HIGH o LOW.")
      if(state.modes[id]===1)state.outputs[id]=args[1]*profile.voltage
      else state.modes[id]=args[1]?2:0
      return 0
    }
    if(name==="digitalRead")return (state.inputs[id]??0)>=profile.threshold?1:0
    if(name==="analogWrite"){
      if(!profile.pwm.includes(pin))throw Error("PWM no disponible en este pin.")
      if(!Number.isInteger(args[1])||args[1]<0||args[1]>255)throw Error("analogWrite requiere un valor entero entre 0 y 255.")
      state.modes[id]=1;state.outputs[id]=args[1]*profile.voltage/255;return 0
    }
    throw Error("Función no compatible: "+name)
  }
  tick(dt){
    for(const [id,runtime] of this.runtimes){
      const mesh=this.sync.getMeshById(id)
      if(!mesh){runtime.stop();this.runtimes.delete(id);continue}
      if(runtime.running)runtime.tick(dt)
      if(runtime.error){
        mesh.userData.arduinoState.powered=false;mesh.userData.arduinoState.outputs={}
      }
      mesh.userData.updateArduinoLed((mesh.userData.arduinoState.outputs[this.profile(id).led]??0)>0)
    }
    this.editor.update()
  }
  observe(graph){
    const alerts=[]
    for(const c of this.appState.components.filter(c=>isProgrammable(c.type))){
      const state=this.sync.getMeshById(c.id)?.userData.arduinoState
      if(!state)continue
      const profile=this.profile(c.id)
      const runtime=this.runtimes.get(c.id)
      if(runtime?.error)alerts.push(profile.name+": "+runtime.error)
      state.inputs={};let total=0
      for(const pin of profile.gpio){
        const reading=graph?.readings.get(c.id+":"+pin+":sense")
        if(reading&&!reading.invalid)state.inputs[pin]=reading.voltage
        const output=graph?.readings.get(c.id+":"+pin+":output")
        if(output&&!output.invalid){
          const current=Math.abs(output.currentA);total+=current
          if(current>0.020)alerts.push(profile.name+" "+pin+": corriente mayor de 20 mA")
        }
        const v=state.inputs[pin]
        if(Number.isFinite(v)&&(v< -0.3||v>profile.voltage+0.3))alerts.push(profile.name+" "+pin+": tensión fuera del rango 0–"+profile.voltage+" V")
      }
      if(total>0.2)alerts.push(profile.name+": corriente total de pines mayor de 200 mA")
      for(const [pin,max] of profile.supplyLimits){
        const read=graph?.readings.get(c.id+":"+pin+":output")
        if(read&&!read.invalid&&Math.abs(read.currentA)>max)alerts.push(profile.name+" "+pin+": sobrecorriente de alimentación")
      }
    }
    this.alerts=[...new Set(alerts)]
  }
}
