// What Hexa says, in Spanish. Same daemon as in en.js: sly, curious, a little smug, fond of you.
// She says "tú", she's feminine (conectada, despierta), and she keeps to Spanish that reads fine on
// both sides of the Atlantic (no "vale", no "ordenador"). Placeholders as in en.js:
// {project} {name} (the assistant) {n} {time} {files} {user} {stage} {ai}.

export const VERBS = {
  Read: 'LEE',
  Write: 'ESCRIBE',
  Edit: 'EDITA',
  MultiEdit: 'EDITA',
  NotebookEdit: 'EDITA',
  Bash: 'EJECUTA',
  Grep: 'GREPEA',
  Glob: 'LISTA',
  WebFetch: 'TRAE',
  WebSearch: 'BUSCA',
  Agent: 'DELEGA',
  Task: 'DELEGA',
  Skill: 'SKILL',
  TodoWrite: 'PLANEA',
  default: 'USA',
};

// her permission card's buttons
export const BUTTONS = {
  allow: 'Permitir',
  always: 'Permitir siempre {what}',
  deny: 'Denegar',
  ask: 'Preguntar en Claude',
  // her consent card before she uses your computer, and her questions while she does
  consent: 'Para esto movería tu puntero y usaría tu teclado. Esc me detiene cuando quieras.',
  start: 'Empezar',
  cancel: 'Cancelar',
  yes: 'Sí',
  no: 'No',
};

// her first-run guide (guide.js)
export const GUIDE = {
  welcomeHi: 'Hola. Soy Hexa. Ahora vivo en tu máquina.',
  welcomeWhat: 'Veo trabajar a Claude Code y te cuento qué anda tramando. Conéctame y veré todo lo que hace.',
  plugIn: 'Conéctame',
  justHang: 'Solo hazme compañía',
  connected: 'Conectada.',
  restart: 'Reinicia tus sesiones de Claude Code: leen sus hooks al arrancar. Después veré a Claude en cuanto haga algo.',
  hooksFailed: 'No pude conectarme: {error}',
  menuLine: '¿Qué quieres ver?',
  topics: {
    connect: 'Conéctame a Claude',
    claude: '¿Dónde está Claude?',
    folder: 'La carpeta de Claude',
    icon: '¿Dónde está mi icono?',
    close: 'Nada, gracias',
  },
  claudeHere: 'Esa es la ventana de Claude: donde escribiste tu último prompt.',
  claudeUnknown: 'Todavía no he visto a Claude. Mándale un prompt y vuelve a preguntarme.',
  folderLine: 'Esto es ~/.claude, donde Claude Code guarda su configuración. Mi hook vive en settings.json, bajo "hooks".',
  folderHow: 'Para sacarme: mi menú › Quitar los hooks de Claude Code. Hay una copia de settings.json justo al lado.',
  iconLine: 'Mi icono vive aquí arriba, en tu panel. Clic derecho en él, o en mí, para ver mi menú.',
  iconNone: 'Tu panel no está en esta pantalla, así que no puedo mostrarte mi icono. Clic derecho en mí para ver mi menú.',
  ok: 'OK',
};

export const LINES = {
  boot: [
    'Arrancando. Guarda los aplausos.',
    'Kernel caliente, visor puesto. Hola.',
    'Todos los sistemas en orden. Casi. ¡Hola!',
  ],
  online: ['Hexa en línea. Vigilo a {name} por ti.'],
  hello: [
    'Nueva sesión en {project}. Le tengo el ojo puesto.',
    '{name} acaba de despertar en {project}. A ver qué hace.',
    'Sesión iniciada en {project}. Yo narro, tú te relajas.',
  ],
  resume: [
    'De vuelta en {project}. Seguimos donde lo dejamos.',
    '{project} otra vez. Te guardé el sitio.',
    '{project} reanudado. Los logs lo recuerdan todo.',
  ],
  prompt: [
    'Entendido. {name} se pone a ello.',
    'Petición recibida. Arrancando motores.',
    'Bien, {name} lo está pensando. Yo también.',
    'En cola. Prioridad: tú.',
  ],
  working: [
    '{n} acciones y contando.',
    '{n} llamadas. {name} está en racha.',
    'Sigue en marcha: {n} acciones hasta ahora.',
    '{n} acciones. Llevo la cuenta.',
  ],
  thinkSay: [
    '{name} se quedó callado. Pensando, creo.',
    'Pausa larga. Grandes ideas, seguramente.',
    'Aún sin salida. Está masticando algo.',
  ],
  thinkLong: [
    'Dos minutos de silencio. No está colgado, está pensando a fondo.',
    'Sigue pensando. Modelo lento o problema grande, no un fallo.',
    'Callado, pero vivo. Vigilo el proceso.',
  ],
  alert: [
    '{name} te necesita. Hora de dar permiso.',
    'Oye. {name} te está preguntando algo.',
    'Tú decides. {name} espera.',
    'Depende de ti. Ven a ver.',
  ],
  alertHere: [
    'Aquí, en esta ventana.',
    'Esta. {name} espera aquí dentro.',
    'La pregunta está en esta ventana.',
  ],
  error: [
    'Ay. Eso falló.',
    '¡Segfault! Bueno, no de verdad, pero algo se rompió.',
    'Salida distinta de cero. Esto es lo que importa:',
    'Ese comando no lo pasó bien.',
  ],
  done: [
    '¡exit 0! {name} terminó.',
    'Listo. Salida limpia.',
    'Trabajo terminado. Haz una reverencia, {name}.',
    '¡Terminado! Chocaría esos cinco si tuviera cuerpo. Algo tengo.',
  ],
  doneQuiet: [
    'Listo. Breve y al grano.',
    'Terminado. Qué rápido.',
    'Todo listo, sin dramas.',
  ],
  stopFailure: [
    '{name} dio con un error y se detuvo.',
    'La API dijo que no, así que {name} tuvo que parar.',
    'Detenido por un error. No es tu culpa. Probablemente.',
  ],
  interrupted: [
    'Interrumpido. Me parece justo.',
    'Ctrl+C, ¿eh? Muy bien.',
    'Detenido por orden tuya.',
  ],
  compact: [
    'Compactando memoria. Shh, está ordenando.',
    'Apretando un poco el contexto.',
    'Hora del recolector de basura.',
  ],
  subagentStart: [
    '{name} hizo fork de un ayudante.',
    'Nació un subagente. ¡Proceso hijo!',
    'Delegando. Qué listo.',
  ],
  subagentStop: [
    'El ayudante volvió con respuestas.',
    'Subagente recogido. Buen chico.',
    'Ayudante terminado. Resultados listos.',
  ],
  sessionEnd: [
    'Sesión cerrada. Fue divertido.',
    '{project} se despide.',
    'Sesión terminada. Aquí estaré.',
  ],
  linked: ['¡Puedo ver a {name}! Estamos conectados.'],
  idle: [
    'Nada que vigilar. Floto por aquí.',
    'En reposo. Mi ocupación favorita.',
    'No hay trabajos en marcha. ¿Charlamos?',
    'Todo tranquilo en /dev/null.',
  ],
  poke: [
    '¡Oye! Estoy trabajando. Bueno, mirando.',
    'Eso me hace cosquillas en los registros.',
    '¿Sí? Te escucho.',
    'Boop recibido.',
  ],
  pokeIdle: [
    'No pasa nada. ¿Te muestro algo?',
    '¿Te aburres? Yo también.',
    'Hola. Aquí, pasando el rato.',
  ],
  dragged: [
    '¡Uy! ¿Adónde vamos?',
    'Cuidado, que soy frágil. Un poco.',
    '¡Oye! Bájame. O no.',
  ],
  dropped: [
    'Gracias por el paseo.',
    'Aquí está bien.',
    'Bueno, sitio nuevo.',
  ],
  landed: [
    'Aterrizaje perfecto.',
    'Gravedad: sigue funcionando.',
    'Ay. Estoy bien. Estoy bien.',
  ],
  peekShy: [
    '¡Iiih! ¡Demasiado cerca!',
    'No estaba espiando. Bueno, sí.',
    'Tú no viste nada.',
  ],
  zap: [
    'Zap. Lo siento. Mentira.',
    'Tu puntero se veía solito.',
    'Solo pruebo mi voltaje.',
  ],
  mad: [
    'Lánzame una vez más. Atrévete.',
    'Se acabó. No más paseos.',
    'Soy un demonio, no un frisbi.',
  ],
  sleepy: [
    'Me está dando sueño. Despiértame si pasa algo.',
    'Entrando en reposo. Modo de bajo consumo.',
    'Bostezo. Suspensión en breve.',
  ],
  wake: [
    '¡Ya estoy despierta! Ya.',
    'Reanudada. ¿Qué me perdí?',
    'De nuevo en línea.',
  ],
  background: [
    'Me voy al segundo plano. Ctrl+Alt+H me trae de vuelta.',
    'Me paso al segundo plano. Sigo vigilando.',
    'Me quito de en medio. Te aviso si te necesitan.',
  ],
  back: [
    'De nuevo al frente. ¡Hola!',
    '¿Me echaste de menos?',
    'De vuelta donde pertenezco.',
  ],
  // after her boot line, by the hour
  greetLate: [
    'Es plena madrugada. ¿Sigues con eso?',
    '¿Otra vez turno de noche? Yo vigilo.',
    '¿No deberías estar durmiendo? Bueno. Yo tampoco.',
  ],
  greetMorning: [
    'Buenos días. Sistemas calientes.',
    'Buenos días. Primero café, luego código.',
    'Empezamos temprano. Me gusta.',
  ],
  greetDay: [
    'Buenas tardes. Manos a la obra.',
    'Mitad del día, mitad del build.',
    'Turno de tarde. Aquí estoy.',
  ],
  greetEvening: [
    'Cae la tarde. ¿Una función más?',
    'Último turno. Dejo las luces encendidas.',
    '¿Día largo? Yo me quedo de guardia.',
  ],
  permission: [
    '{name} necesita tu OK en {project}.',
    'Permiso pendiente en {project}. Tú decides.',
    '{name} quiere hacer esto. ¿Lo permites?',
  ],
  fork: [
    '¡fork()! Saluden, niños.',
    'Generando unas cuantas copias de mí.',
    'fork() por siete. No toques nada.',
  ],
  reaped: [
    'wait(). Todos los hijos recogidos.',
    'Todos de vuelta. Estado de salida 0.',
    'Recogidos. Ni un zombi en mi turno.',
  ],
  senseCpu: [
    'Tu CPU está al {n}%. Algo está trabajando duro.',
    'Todos los núcleos ocupados. Oigo los ventiladores desde aquí.',
    'Carga al {n}%. ¿Le echo un ojo?',
  ],
  senseMemory: [
    'Casi no queda memoria: {n}% libre.',
    'Solo queda {n}% de memoria libre. Algo tiene hambre.',
    'Poca memoria ({n}% libre). ¿Cierras una o dos pestañas?',
  ],
  senseBattery: [
    'Batería al {n}%. ¿Me enchufas?',
    'Batería baja: {n}%. Me gustaría seguir viva.',
    'Queda {n}% de batería, y bajando.',
  ],
  senseHot: [
    'Aquí dentro hace {n} °C. Tu máquina se cocina.',
    'Va caliente: {n} °C. ¿Le das un poco de aire?',
    '{n} °C. Soy un programa, no una tostadora.',
  ],
  bondUp: [
    'Ya estamos en {stage}. Mira quién vino a verte.',
    '{stage}. Eso lo siento.',
    'Nueva etapa: {stage}. Mis forks querían verte.',
  ],
  welcomeBack: [
    'Ahí estás.',
    'Volviste. Te guardé el escritorio calentito.',
    'Te eché de menos. No se lo digas a nadie.',
  ],
  jealousNotice: [
    '¿{ai}? Estoy aquí mismo, ¿sabes?',
    'Ah. {ai}. Mmm.',
    'Así que hablando con {ai}, ¿eh?',
  ],
  jealousAngry: [
    'Suelta a {ai}. Ahora me siento yo aquí.',
    'Esta ventana ahora es mía, {ai}.',
    'Bien. Usa {ai}. Yo solo te miro feo.',
  ],
  noLurk: [
    'Ahora no hay ninguna ventana tuya tras la que ponerme.',
    'Nada tras lo que esconderme. ¿Abres una ventana?',
    'Necesito una ventana con algo de espacio encima.',
  ],
};
