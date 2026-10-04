// Hecho e implementado por LFTS
import * as THREE from "three"
import { ARDUINO_HELP, BLINK_SKETCH } from "../core/ArduinoSketch.js"

// Editor HTML completo y edición por líneas dentro de XR con teclado del sistema. Hecho e implementado por LFTS
export class ArduinoEditor {
  constructor(system) {
    this.system=system;this.id=null;this.line=0;this.panel=null;this.lastView=""
    this.element=document.createElement("section")
    this.element.style.cssText="display:none;position:fixed;inset:3%;z-index:10000;padding:18px;background:#14232f;color:white;font:16px system-ui;overflow:auto;border:2px solid #4fc3c8;border-radius:14px"
    this.element.innerHTML='<h2>Arduino Uno · editor educativo .ino</h2><p></p><div class="actions"></div><textarea aria-label="Código Arduino" spellcheck="false" style="box-sizing:border-box;width:100%;height:44vh;margin-top:12px;background:#07141d;color:#daf6ed;font:17px monospace;padding:12px;tab-size:2"></textarea><p role="status"></p><pre aria-label="Monitor serie" style="white-space:pre-wrap;max-height:18vh;overflow:auto"></pre><details><summary>Compatibilidad y uso</summary></details>'
    this.element.querySelector("p").textContent="Importa .ino o .txt, pega código o escribe. Guardar conserva el programa; Ejecutar inicia la simulación. Regresa a VR con el botón de entrada."
    this.element.querySelector("details").append(document.createTextNode(ARDUINO_HELP))
    this.textarea=this.element.querySelector("textarea");this.status=this.element.querySelector('[role="status"]');this.serial=this.element.querySelector("pre")
    this.textarea.addEventListener("input",()=>this.save(this.textarea.value))
    this.element.addEventListener("keydown",e=>e.stopPropagation())
    this.element.addEventListener("beforexrselect",e=>e.preventDefault())
    const actions={"Verificar":()=>this.verify(),"Ejecutar":()=>system.run(this.id),"Detener":()=>system.stop(this.id),"Reiniciar":()=>system.run(this.id),"Guardar circuito":()=>this.saveCircuit(),"Copiar":()=>this.copy(),"Pegar":()=>this.paste(),"Importar archivo":()=>this.file.click(),"Descargar .ino":()=>this.download(),"Ejemplo Blink":()=>{this.save(this.profile().blink);this.refreshText()},"Cerrar":()=>this.close()}
    for(const [label,fn] of Object.entries(actions)){
      const button=document.createElement("button");button.textContent=label
      button.style.cssText="margin:4px;padding:10px;background:#daf6ed;border:0;border-radius:5px;color:#14232f"
      button.onclick=fn;this.element.querySelector(".actions").append(button)
    }
    this.file=document.createElement("input");this.file.type="file";this.file.accept=".ino,.txt,text/plain";this.file.hidden=true
    this.file.onchange=async()=>{
      const file=this.file.files?.[0];this.file.value="";if(!file)return
      if(!/\.(ino|txt)$/i.test(file.name)||file.size>32768){this.message("Selecciona un .ino o .txt de hasta 32 KB.");return}
      const targetId=this.id
      try{const text=await file.text();if(this.id!==targetId)return;this.save(text);this.refreshText();this.message("Archivo importado. Verifica antes de ejecutar.")}
      catch{this.message("No se pudo leer el archivo seleccionado.")}
    }
    this.element.append(this.file);document.body.append(this.element)
    this.lineInput=document.createElement("input");this.lineInput.type="text";this.lineInput.autocomplete="off";this.lineInput.setAttribute("aria-label","Editar línea Arduino")
    this.lineInput.style.cssText="position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none"
    this.lineInput.addEventListener("keydown",e=>e.stopPropagation())
    this.lineInput.oninput=()=>{
      if(!this.id)return
      const lines=this.source().split("\n");lines[this.line]=this.lineInput.value
      this.save(lines.join("\n"));this.refreshText()
    }
    document.body.append(this.lineInput)
    system.interaction.renderer.xr.addEventListener("sessionend",()=>{this.lineInput.blur();if(this.id){this.disposePanel();this.element.style.display="block";this.refreshText()}})
    system.interaction.renderer.xr.addEventListener("sessionstart",()=>{if(this.id){this.element.style.display="none";this.createPanel()}})
  }
  profile(){return this.system.profile?.(this.id)??{name:"Arduino Uno",blink:BLINK_SKETCH,help:ARDUINO_HELP,type:"arduinoUno"}}
  source(){return this.system.component(this.id)?.meta?.source??this.profile().blink}
  save(source) {
    if(source.length>32768){this.message("El límite es 32 KB.");return}
    const c=this.system.component(this.id);if(!c)return
    this.system.appState.updateComponent(c.id,{meta:{...c.meta,source}})
  }
  refreshText(){this.textarea.value=this.source()}
  saveCircuit(){try{localStorage.setItem("vr_circuit_state",this.system.appState.toJSON());this.message("Circuito y programa guardados en este navegador.")}catch{this.message("No se pudo guardar. Descarga el programa como .ino.")}}
  message(text){this.notice=text;this.status.textContent=text;this.lastView=""}
  verify(){try{this.system.verify(this.source());this.message("Sintaxis compatible. Los errores de ejecución aparecerán al iniciar.")}catch(e){this.message(e.message)}}
  open(id){
    this.close();this.id=id;this.element.querySelector("h2").textContent=this.profile().name+" · editor educativo .ino";this.element.querySelector("details").textContent=this.profile().help;this.line=0;this.notice="";this.refreshText()
    if(this.system.interaction.renderer.xr.isPresenting)this.createPanel();else this.element.style.display="block"
  }
  async browser(){
    const session=this.system.interaction.renderer.xr.getSession?.()
    try{if(session)await session.end();this.element.style.display="block";this.refreshText();this.message("Puedes editar, pegar o seleccionar un archivo. Después vuelve a entrar a VR.")}
    catch{this.message("Abre el editor desde el navegador al salir de VR.")}
  }
  keyboard(){
    const session=this.system.interaction.renderer.xr.getSession?.()
    if(!session?.isSystemKeyboardSupported){this.message("Teclado XR no disponible. Usa Navegador.");return}
    this.lineInput.value=this.source().split("\n")[this.line]??""
    this.lineInput.focus()
    this.message("Editando línea "+(this.line+1)+". El teclado puede sustituir la línea completa.")
  }
  async copy(){try{await navigator.clipboard.writeText(this.source());this.message("Código copiado.")}catch{this.message("No se pudo copiar. Selecciona el texto y usa Copiar del navegador.")}}
  async paste(){
    const target=this.id
    try{const value=await navigator.clipboard.readText();if(this.id!==target)return;if(!value){this.message("El portapapeles no contiene texto.");return}this.save(value);this.refreshText();this.message("Texto pegado como programa; todavía no se ejecutó.")}
    catch{this.message("Pegado no autorizado. Usa Navegador y su opción Pegar.")}
  }
  download(){
    const url=URL.createObjectURL(new Blob([this.source()],{type:"text/plain;charset=utf-8"}))
    const link=document.createElement("a");link.href=url;link.download="circuito-"+this.profile().type+".ino";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  changeLine(delta){this.lineInput.blur();this.line=Math.max(0,Math.min(this.source().split("\n").length-1,this.line+delta));this.lastView=""}
  insertLine(){this.lineInput.blur();const lines=this.source().split("\n");lines.splice(++this.line,0,"");this.save(lines.join("\n"));this.refreshText()}
  deleteLine(){this.lineInput.blur();const lines=this.source().split("\n");lines.splice(this.line,1);this.save(lines.join("\n"));this.changeLine(0);this.refreshText()}
  createPanel(){
    this.disposePanel()
    const group=new THREE.Group(),camera=this.system.interaction.camera
    group.position.copy(camera.getWorldPosition(new THREE.Vector3()))
    group.position.add(new THREE.Vector3(0,-0.02,-0.85).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())))
    group.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()))
    const canvas=document.createElement("canvas");canvas.width=1536;canvas.height=1024
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(0.8,0.53),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));screen.position.y=0.13;group.add(screen)
    const buttons=[],textures=[texture]
    const actions=[["Teclado",()=>this.keyboard()],["Anterior",()=>this.changeLine(-1)],["Siguiente",()=>this.changeLine(1)],["Nueva línea",()=>this.insertLine()],["Borrar línea",()=>this.deleteLine()],["Pegar",()=>this.paste()],["Archivos",()=>this.browser()],["Navegador",()=>this.browser()],["Ejecutar",()=>this.system.run(this.id)],["Detener",()=>this.system.stop(this.id)],["Verificar",()=>this.verify()],["Cerrar",()=>this.close()]]
    actions.forEach(([label,fn],i)=>{
      const c=document.createElement("canvas");c.width=512;c.height=128
      const ctx=c.getContext("2d");ctx.fillStyle="#19677a";ctx.fillRect(0,0,512,128);ctx.fillStyle="white";ctx.font="bold 48px Arial";ctx.textAlign="center";ctx.fillText(label,256,82)
      const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;textures.push(t)
      const button=new THREE.Mesh(new THREE.BoxGeometry(0.19,0.045,0.012),new THREE.MeshBasicMaterial({map:t}))
      button.position.set((i%4-1.5)*0.202,-0.17-Math.floor(i/4)*0.057,0)
      button.userData.isUI=true;button.userData.onPress=fn;group.add(button);buttons.push(button);this.system.interaction.register(button)
    })
    this.system.scene.add(group);this.panel={group,canvas,texture,buttons,textures};this.lastView=""
  }
  update(){
    if(!this.id)return
    if(!this.system.component(this.id)){this.close();return}
    const runtime=this.system.runtimes.get(this.id),state=this.system.sync.getMeshById(this.id)?.userData.arduinoState
    const status=this.notice||runtime?.error||(runtime?.running?"Ejecutando":"Detenido"),serial=state?.serial||""
    this.status.textContent=status;this.serial.textContent=serial
    if(!this.panel)return
    const text=this.source(),view=JSON.stringify([text,this.line,status,serial])
    if(view===this.lastView)return;this.lastView=view
    const ctx=this.panel.canvas.getContext("2d");ctx.fillStyle="#102331";ctx.fillRect(0,0,1536,1024)
    ctx.fillStyle="#83ead6";ctx.font="bold 44px Arial";ctx.fillText(this.profile().name+" · .ino educativo · línea "+(this.line+1),28,58)
    ctx.font="27px Arial";ctx.fillText("Edición por líneas · Archivos abre el navegador · PWM aproximado",28,100)
    const lines=text.split("\n"),first=Math.max(0,this.line-6)
    ctx.font="32px monospace"
    lines.slice(first,first+15).forEach((line,i)=>{
      const selected=first+i===this.line
      if(selected){ctx.fillStyle="#265969";ctx.fillRect(16,122+i*42,1504,42)}
      ctx.fillStyle=selected?"#ffffff":"#bde0e5";ctx.fillText(String(first+i+1).padStart(3)+" "+line.slice(0,69),28,153+i*42)
    })
    ctx.font="30px Arial";ctx.fillStyle="#ffda8a"
    ctx.fillText(status.slice(0,88),28,813)
    ctx.fillStyle="#a9dad0";ctx.font="28px monospace"
    serial.split("\n").slice(-4).forEach((line,i)=>ctx.fillText(line.slice(0,90),28,858+i*34))
    this.panel.texture.needsUpdate=true
  }
  disposePanel(){
    if(!this.panel)return
    for(const button of this.panel.buttons){this.system.interaction.unregister(button);if(this.system.interaction._lastPokedButton===button)this.system.interaction._lastPokedButton=null}
    this.system.scene.remove(this.panel.group)
    this.panel.group.traverse(o=>{o.geometry?.dispose();o.material?.dispose()})
    for(const t of this.panel.textures)t.dispose()
    this.panel=null
  }
  close(){this.lineInput?.blur();this.disposePanel();this.id=null;this.element.style.display="none"}
}
