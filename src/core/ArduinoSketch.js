// Hecho e implementado por LFTS
// Intérprete educativo de un subconjunto explícito de Arduino C/C++; no ejecuta JavaScript del usuario. Hecho e implementado por LFTS
export const BLINK_SKETCH = "// LED integrado y pin D13. Hecho e implementado por LFTS\nvoid setup() {\n  pinMode(LED_BUILTIN, OUTPUT);\n}\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH);\n  delay(500);\n  digitalWrite(LED_BUILTIN, LOW);\n  delay(500);\n}\n"
export const ARDUINO_HELP = "Subconjunto .ino: setup/loop, variables int/long/byte/bool/float, const, if/else, while, for, operadores aritméticos y lógicos; pinMode, digitalWrite/Read, analogWrite/Read, delay, millis, Serial.begin/print/println. Sin librerías, arrays, punteros, clases, funciones propias ni compilación AVR. PWM se aproxima por voltaje medio; no hay temporización de microcontrolador."
const constants = { HIGH:1, LOW:0, INPUT:0, OUTPUT:1, INPUT_PULLUP:2, LED_BUILTIN:13, true:1, false:0, A0:14,A1:15,A2:16,A3:17,A4:18,A5:19 }
const arity = { pinMode:2,digitalWrite:2,digitalRead:1,analogWrite:2,analogRead:1,delay:1,millis:0,"Serial.begin":1,"Serial.print":1,"Serial.println":1 }
const types = new Set(["int","long","byte","bool","float"])
const precedence = { "||":1,"&&":2,"==":3,"!=":3,"<":4,">":4,"<=":4,">=":4,"+":5,"-":5,"*":6,"/":6,"%":6 }

export function compileSketch(source) {
  if (typeof source !== "string" || source.length > 32768) throw Error("El programa debe tener como máximo 32 KB.")
  const tokens = []; let offset=0, line=1
  while (offset < source.length) {
    const rest=source.slice(offset)
    const m=/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\["\\nt]|[^"\\\n])*"|(?:\d+\.\d*|\d+)|[A-Za-z_]\w*(?:\.(?:begin|println|print))?|\+\+|--|\+=|-=|==|!=|<=|>=|&&|\|\||[{}();,+*/%!=<>-])/.exec(rest)
    if (!m) throw Error("Línea "+line+": símbolo o sintaxis no compatible.")
    const text=m[0]
    if (!/^\s|^\/[/*]/.test(text)) tokens.push({text,line})
    line+=(text.match(/\n/g)||[]).length; offset+=text.length
    if (tokens.length > 10000) throw Error("Programa demasiado complejo.")
  }
  tokens.push({text:"<fin>",line}); let i=0, depth=0
  const at=()=>tokens[i].text
  const fail=message=>{ throw Error("Línea "+tokens[i].line+": "+message) }
  const take=()=>tokens[i++].text
  const expect=text=>{ if(at()!==text)fail("Se esperaba "+text);take() }
  const name=()=>{if(!/^[A-Za-z_]\w*$/.test(at()))fail("Se esperaba un identificador");return take()}
  function expression(min=0) {
    if (++depth > 80) fail("Demasiados niveles de expresión")
    let left
    if (["!","-","+"].includes(at())) left={kind:"unary",op:take(),value:expression(7)}
    else if (at()==="(") { take();left=expression();expect(")") }
    else if (/^\d/.test(at())) { const raw=take();left={kind:"literal",value:Number(raw),floating:raw.includes(".")} }
    else if (at().startsWith('"')) left={kind:"literal",value:JSON.parse(take())}
    else {
      const id=take()
      if (!/^[A-Za-z_]\w*(?:\.(?:begin|println|print))?$/.test(id)) fail("Expresión no compatible")
      if (at()==="(") {
        if (!(id in arity)) fail("Función no compatible: "+id)
        take(); const args=[]
        if(at()!==")") { do {args.push(expression());if(at()!==",")break;take()} while(true) }
        expect(")")
        if(args.length!==arity[id]) fail("Número de argumentos incorrecto: "+id)
        left={kind:"call",id,args}
      } else left={kind:"name",id}
    }
    while (precedence[at()] && precedence[at()]>=min) {
      const op=take();left={kind:"binary",op,left,right:expression(precedence[op]+1)}
    }
    depth--;return left
  }
  function simple() {
    if(at()==="const" || types.has(at())) {
      const constant=at()==="const";if(constant)take()
      const type=take();if(!types.has(type))fail("Tipo no compatible")
      const id=name();let value={kind:"literal",value:0}
      if(at()==="="){take();value=expression()}else if(constant)fail("Una constante necesita valor")
      return {kind:"declare",id,type,constant,value}
    }
    if (/^[A-Za-z_]\w*$/.test(at()) && ["=","+=","-=","++","--"].includes(tokens[i+1]?.text)) {
      const id=take(),op=take()
      return {kind:"assign",id,op,value:["++","--"].includes(op)?{kind:"literal",value:1}:expression()}
    }
    return {kind:"expr",value:expression()}
  }
  let statementDepth=0
  function statement() {
    if(++statementDepth>60)fail("Demasiados bloques anidados")
    let result
    if(at()==="{"){
      take();const body=[];while(at()!=="}"){if(at()==="<fin>")fail("Falta cerrar bloque");body.push(statement())}
      take();result={kind:"block",body}
    } else if(at()==="if"){
      take();expect("(");const condition=expression();expect(")");const yes=statement()
      let no=null;if(at()==="else"){take();no=statement()}result={kind:"if",condition,yes,no}
    } else if(at()==="while"){
      take();expect("(");const condition=expression();expect(")");result={kind:"while",condition,body:statement()}
    } else if(at()==="for"){
      take();expect("(");const init=at()===";"?null:simple();expect(";")
      const condition=at()===";"?{kind:"literal",value:1}:expression();expect(";")
      const increment=at()===")"?null:simple();expect(")")
      result={kind:"for",init,condition,increment,body:statement()}
    } else if(at()===";"){take();result={kind:"block",body:[]}}
    else {result=simple();expect(";")}
    statementDepth--;return result
  }
  const globals=[],functions={}
  while(at()!=="<fin>"){
    if(at()==="void"){
      take();const id=name();if(!["setup","loop"].includes(id)||functions[id])fail("Solo se permiten setup y loop una vez")
      expect("(");expect(")")
      if(at()!=="{")fail("Falta el cuerpo de "+id)
      functions[id]=statement()
    } else {
      const declaration=simple();if(declaration.kind!=="declare")fail("Solo declaraciones globales fuera de setup y loop")
      expect(";");globals.push(declaration)
    }
  }
  if(!functions.setup || !functions.loop)fail("Define void setup() y void loop()")
  return {globals,...functions}
}

export class ArduinoSketch {
  constructor(source, io) {
    this.constants=io.constants??constants;this.intBits=io.intBits??16;this.program=compileSketch(source);this.io=io;this.scopes=[new Map()]
    this.time=0;this.waitUntil=0;this.running=true;this.error="";this.instructions=0
    this.iterator=this.execute()
  }
  entry(id) {
    for(let i=this.scopes.length-1;i>=0;i--)if(this.scopes[i].has(id))return this.scopes[i].get(id)
    throw Error("Variable no definida: "+id)
  }
  cast(type,value) {
    if(typeof value!=="number" || !Number.isFinite(value))throw Error("Valor numérico inválido")
    if(type==="bool")return value?1:0
    if(type==="byte")return (Math.trunc(value)%256+256)%256
    if(type==="int")return this.intBits===32?Math.trunc(value)|0:(Math.trunc(value)<<16)>>16
    if(type==="long")return Math.trunc(value)|0
    return value
  }
  value(node) {
    if(node.kind==="literal")return node.value
    if(node.kind==="name")return Object.hasOwn(this.constants,node.id)?this.constants[node.id]:this.entry(node.id).value
    if(node.kind==="call"){
      if(node.id==="delay")throw Error("delay debe ser una instrucción independiente.")
      if(node.id==="millis")return Math.floor(this.time)
      return this.io.call(node.id,node.args.map(a=>this.value(a)))
    }
    if(node.kind==="unary"){
      const v=this.value(node.value);if(typeof v!=="number")throw Error("Operación no numérica")
      return node.op==="!"?Number(!v):node.op==="-"?-v:v
    }
    const a=this.value(node.left)
    if(node.op==="&&")return Number(!!a && !!this.value(node.right))
    if(node.op==="||")return Number(!!a || !!this.value(node.right))
    const b=this.value(node.right)
    if(typeof a!=="number" || typeof b!=="number")throw Error("Usa cadenas solo en Serial.print/println.")
    const ops={"+":()=>a+b,"-":()=>a-b,"*":()=>a*b,"/":()=>a/b,"%":()=>a%b,"==":()=>Number(a===b),"!=":()=>Number(a!==b),"<":()=>Number(a<b),">":()=>Number(a>b),"<=":()=>Number(a<=b),">=":()=>Number(a>=b)}
    if(["/","%"].includes(node.op)&&b===0)throw Error("División entre cero.")
    let v=ops[node.op]();if(!Number.isFinite(v))throw Error("Resultado fuera de rango.")
    if(node.op==="/" && this.integerExpression(node.left) && this.integerExpression(node.right))v=Math.trunc(v)
    return v
  }
  integerExpression(node) {
    if(node.kind==="literal")return !node.floating && typeof node.value==="number"
    if(node.kind==="name")return Object.hasOwn(this.constants,node.id) || this.entry(node.id).type!=="float"
    if(node.kind==="call")return true
    if(node.kind==="unary")return this.integerExpression(node.value)
    return this.integerExpression(node.left)&&this.integerExpression(node.right)
  }
  *statement(node) {
    yield null
    if(node.kind==="block"){
      this.scopes.push(new Map());try{for(const s of node.body)yield* this.statement(s)}finally{this.scopes.pop()}
    } else if(node.kind==="declare"){
      const scope=this.scopes.at(-1)
      if(scope.has(node.id)||Object.hasOwn(this.constants,node.id))throw Error("Nombre duplicado o reservado: "+node.id)
      scope.set(node.id,{type:node.type,constant:node.constant,value:this.cast(node.type,this.value(node.value))})
    } else if(node.kind==="assign"){
      const target=this.entry(node.id);if(target.constant)throw Error("No puedes modificar una constante.")
      const v=this.value(node.value),sum=["+=","++"].includes(node.op),sub=["-=","--"].includes(node.op)
      target.value=this.cast(target.type,sum?target.value+v:sub?target.value-v:v)
    } else if(node.kind==="expr"){
      if(node.value.kind==="call" && node.value.id==="delay"){
        const ms=this.value(node.value.args[0])
        if(!Number.isFinite(ms)||ms<0||ms>3600000)throw Error("delay admite de 0 a 3600000 ms.")
        yield {delay:ms}
      } else {
        this.value(node.value)
        // Permitir que el circuito resuelva una escritura antes de leer sus entradas. Hecho e implementado por LFTS
        if(node.value.kind==="call" && ["pinMode","digitalWrite","analogWrite"].includes(node.value.id))yield {frame:true}
      }
    } else if(node.kind==="if"){
      if(this.value(node.condition))yield* this.statement(node.yes);else if(node.no)yield* this.statement(node.no)
    } else if(node.kind==="while"){
      while(this.value(node.condition)){yield null;yield* this.statement(node.body)}
    } else if(node.kind==="for"){
      this.scopes.push(new Map())
      try{
        if(node.init)yield* this.statement(node.init)
        while(this.value(node.condition)){yield null;yield* this.statement(node.body);if(node.increment)yield* this.statement(node.increment)}
      }finally{this.scopes.pop()}
    }
  }
  *execute(){
    for(const s of this.program.globals)yield* this.statement(s)
    yield* this.statement(this.program.setup)
    while(true){yield* this.statement(this.program.loop);yield {frame:true,loop:true}}
  }
  tick(dt) {
    if(!this.running)return
    this.time+=Math.min(Math.max(dt,0),0.1)*1000
    if(this.time<this.waitUntil)return
    try{
      for(let n=0;n<300;n++){
        if(++this.instructions>60000)throw Error("Bucle demasiado largo: añade delay o revisa su condición.")
        const step=this.iterator.next()
        if(step.done){this.running=false;break}
        if(step.value?.delay!==undefined){this.waitUntil=this.time+step.value.delay;this.instructions=0;break}
        if(step.value?.frame){if(step.value.loop)this.instructions=0;break}
      }
    }catch(error){this.error=error.message;this.running=false}
  }
  stop(){this.running=false;this.iterator.return?.()}
}

