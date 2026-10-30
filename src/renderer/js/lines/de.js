// What Hexa says, in German. Same daemon as in en.js: sly, curious, a little smug, fond of you.
// She says "du", and keys are named as on a German keyboard (Strg, Umschalt).
// Placeholders as in en.js: {project} {name} (the assistant) {n} {time} {files} {user} {stage} {ai}.

export const VERBS = {
  Read: 'LIEST',
  Write: 'SCHREIBT',
  Edit: 'ÄNDERT',
  MultiEdit: 'ÄNDERT',
  NotebookEdit: 'ÄNDERT',
  Bash: 'STARTET',
  Grep: 'GREPPT',
  Glob: 'FINDET',
  WebFetch: 'LÄDT',
  WebSearch: 'SUCHT',
  Agent: 'DELEGIERT',
  Task: 'DELEGIERT',
  Skill: 'SKILL',
  TodoWrite: 'PLANT',
  default: 'NUTZT',
};

// her permission card's buttons
export const BUTTONS = {
  allow: 'Erlauben',
  always: 'Immer erlauben: {what}',
  deny: 'Ablehnen',
  ask: 'In Claude fragen',
  // her consent card before she uses your computer, and her questions while she does
  consent: 'Dafür würde ich deine Maus und Tastatur benutzen. Esc stoppt mich jederzeit.',
  start: 'Los',
  cancel: 'Abbrechen',
  yes: 'Ja',
  no: 'Nein',
};

// her first-run guide (guide.js)
export const GUIDE = {
  welcomeHi: 'Hi. Ich bin Hexa. Ich wohne jetzt in deinem Rechner.',
  welcomeWhat: 'Ich schaue Claude Code bei der Arbeit zu und sage dir, was da los ist. Schließ mich an, dann sehe ich alles, was es tut.',
  plugIn: 'Schließ mich an',
  justHang: 'Leiste mir einfach Gesellschaft',
  connected: 'Angeschlossen.',
  restart: 'Starte deine Claude-Code-Sitzungen neu: Sie lesen ihre Hooks beim Start. Dann sehe ich Claude, sobald es etwas tut.',
  hooksFailed: 'Anschließen hat nicht geklappt: {error}',
  menuLine: 'Was willst du sehen?',
  topics: {
    connect: 'Schließ mich an Claude an',
    claude: 'Wo ist Claude?',
    folder: 'Claudes Ordner',
    icon: 'Wo ist mein Symbol?',
    close: 'Nichts, danke',
  },
  claudeHere: 'Das ist Claudes Fenster: das, in dem du deinen letzten Prompt getippt hast.',
  claudeUnknown: 'Ich habe Claude noch nicht gesehen. Schick ihm einen Prompt und frag mich nochmal.',
  folderLine: 'Das ist ~/.claude, da hebt Claude Code seine Einstellungen auf. Mein Hook wohnt in settings.json, unter "hooks".',
  folderHow: 'Um mich rauszunehmen: mein Menü › Claude Code-Hooks entfernen. Ein Backup von settings.json liegt gleich daneben.',
  iconLine: 'Mein Symbol wohnt hier oben, in deiner Leiste. Rechtsklick darauf, oder auf mich, für mein Menü.',
  iconNone: 'Deine Leiste ist nicht auf diesem Bildschirm, also kann ich dir mein Symbol nicht zeigen. Rechtsklick auf mich für mein Menü.',
  ok: 'OK',
};

export const LINES = {
  boot: [
    'Fahre hoch. Applaus bitte später.',
    'Kernel warm, Visier runter. Hi.',
    'Alle Systeme laufen. Meistens. Hi!',
  ],
  online: ['Hexa online. Ich behalte {name} für dich im Auge.'],
  hello: [
    'Neue Sitzung in {project}. Ich hab ein Auge drauf.',
    '{name} ist gerade in {project} aufgewacht. Mal sehen, was passiert.',
    'Sitzung in {project} läuft. Ich erzähle, du entspannst.',
  ],
  resume: [
    'Zurück in {project}. Wir machen weiter, wo wir waren.',
    'Schon wieder {project}. Ich hab dir den Platz warm gehalten.',
    '{project} fortgesetzt. Die Logs vergessen nichts.',
  ],
  prompt: [
    'Verstanden. {name} ist dran.',
    'Anfrage erhalten. Läuft an.',
    'Okay, {name} denkt drüber nach. Ich auch.',
    'In der Warteschlange. Priorität: du.',
  ],
  working: [
    '{n} Aktionen, Tendenz steigend.',
    '{n} Tool-Aufrufe. {name} ist in Fahrt.',
    'Läuft noch: {n} Aktionen bisher.',
    '{n} Aktionen. Ich zähle mit.',
  ],
  thinkSay: [
    '{name} ist still geworden. Denkt nach, glaube ich.',
    'Lange Pause. Große Gedanken, vermutlich.',
    'Noch keine Ausgabe. Da kaut jemand auf was rum.',
  ],
  thinkLong: [
    'Zwei Minuten Stille. Nichts hängt, da wird scharf nachgedacht.',
    'Denkt noch. Langsames Modell oder großes Problem, kein Absturz.',
    'Still, aber lebendig. Ich beobachte den Prozess.',
  ],
  alert: [
    '{name} braucht dich. Zeit für eine Erlaubnis.',
    'Hey. {name} fragt dich was.',
    'Deine Entscheidung. {name} wartet.',
    'Hängt an dir. Komm mal schauen.',
  ],
  alertHere: [
    'Hier drüben, in diesem Fenster.',
    'Dieses hier. {name} wartet da drin.',
    'Die Frage steht in diesem Fenster.',
  ],
  error: [
    'Autsch. Das ging schief.',
    'Segfault! Okay, nicht wirklich, aber was ist kaputt.',
    'Exit-Code ungleich null. Das hier ist der wichtige Teil:',
    'Der Befehl hatte keinen Spaß.',
  ],
  done: [
    'exit 0! {name} ist fertig.',
    'Fertig. Sauberer Exit.',
    'Job erledigt. Verbeug dich, {name}.',
    'Fertig! Ich würd dich abklatschen, hätt ich Hände. Hab ich irgendwie.',
  ],
  doneQuiet: [
    'Fertig. Kurz und knackig.',
    'Erledigt. Das ging schnell.',
    'Alles fertig, kein Drama.',
  ],
  stopFailure: [
    '{name} ist auf einen Fehler gestoßen und hat aufgehört.',
    'Die API hat Nein gesagt, also musste {name} aufhören.',
    'Fehler, also Stopp. Nicht deine Schuld. Wahrscheinlich.',
  ],
  interrupted: [
    'Unterbrochen. Na gut.',
    'Strg+C, was? Okay.',
    'Auf dein Wort gestoppt.',
  ],
  compact: [
    'Speicher wird komprimiert. Psst, hier wird aufgeräumt.',
    'Der Kontext wird ein bisschen zusammengequetscht.',
    'Zeit für die Müllabfuhr.',
  ],
  subagentStart: [
    '{name} hat einen Helfer geforkt.',
    'Ein Subagent ist gespawnt. Kindprozess!',
    'Delegieren. Schlau.',
  ],
  subagentStop: [
    'Der Helfer ist mit Antworten zurück.',
    'Subagent abgeholt. Braves Kind.',
    'Helfer fertig. Ergebnisse da.',
  ],
  sessionEnd: [
    'Sitzung beendet. Hat Spaß gemacht.',
    '{project} meldet sich ab.',
    'Sitzung vorbei. Ich bleib hier.',
  ],
  linked: ['Ich sehe {name}! Wir sind verbunden.'],
  idle: [
    'Nichts zu sehen. Ich schwebe hier rum.',
    'Leerlauf. Meine liebste Art von beschäftigt.',
    'Keine Jobs. Wollen wir reden?',
    'Alles ruhig auf /dev/null.',
  ],
  poke: [
    'Hey! Ich arbeite hier. Na ja, ich schaue zu.',
    'Das kitzelt in meinen Registern.',
    'Ja? Ich höre.',
    'Stups empfangen.',
  ],
  pokeIdle: [
    'Hier passiert nichts. Soll ich dir was zeigen?',
    'Langweilig? Mir auch.',
    'Hi. Ich häng nur so rum.',
  ],
  dragged: [
    'Huch, wo geht’s hin?',
    'Vorsicht, zerbrechlich. Irgendwie.',
    'Hey! Lass mich runter. Oder nicht.',
  ],
  dropped: [
    'Danke fürs Mitnehmen.',
    'Hier passt.',
    'Okay, neuer Platz.',
  ],
  landed: [
    'Landung sitzt.',
    'Schwerkraft: funktioniert noch.',
    'Au. Alles gut. Alles gut.',
  ],
  peekShy: [
    'Iiih. Zu nah!',
    'Ich hab nicht geguckt. Okay, hab ich.',
    'Du hast nichts gesehen.',
  ],
  zap: [
    'Zap. Tut mir leid. Nicht.',
    'Dein Mauszeiger sah einsam aus.',
    'Teste nur meine Spannung.',
  ],
  mad: [
    'Wirf mich noch einmal. Na los, trau dich.',
    'Das war’s. Keine Fahrten mehr.',
    'Ich bin ein Daemon, kein Frisbee.',
  ],
  sleepy: [
    'Ich werde müde. Weck mich, wenn was passiert.',
    'Gehe in den Leerlauf. Energiesparmodus.',
    'Gähn. Gleich im Standby.',
  ],
  wake: [
    'Bin wach! Bin wach.',
    'Fortgesetzt. Was hab ich verpasst?',
    'Wieder online.',
  ],
  background: [
    'Ab in den Hintergrund. Strg+Alt+H holt mich zurück.',
    'Ich verzieh mich nach hinten. Zuschauen tu ich trotzdem.',
    'Aus dem Weg. Ich melde mich, wenn du gebraucht wirst.',
  ],
  back: [
    'Wieder im Vordergrund. Hi!',
    'Hast du mich vermisst?',
    'Wieder da, wo ich hingehöre.',
  ],
  // after her boot line, by the hour
  greetLate: [
    'Mitten in der Nacht. Immer noch dran?',
    'Wieder Nachtschicht? Ich halte Wache.',
    'Solltest du nicht schlafen? Na gut. Ich auch nicht.',
  ],
  greetMorning: [
    'Morgen. Systeme warm.',
    'Guten Morgen. Erst Kaffee, dann Code.',
    'Früher Start. Gefällt mir.',
  ],
  greetDay: [
    'Nachmittag. Lass uns was schaffen.',
    'Mitten am Tag, mitten im Build.',
    'Nachmittagsschicht. Ich bin da.',
  ],
  greetEvening: [
    'Abend. Noch ein Feature?',
    'Abendschicht. Ich lass das Licht an.',
    'Langer Tag? Ich übernehme die Wache.',
  ],
  permission: [
    '{name} braucht dein OK in {project}.',
    'Erlaubnis-Check aus {project}. Deine Entscheidung.',
    '{name} will das hier tun. Erlauben?',
  ],
  fork: [
    'fork()! Sagt hallo, Kinder.',
    'Ich spawne ein paar von mir.',
    'fork() mal sieben. Nichts anfassen.',
  ],
  reaped: [
    'wait(). Alle Kinder eingesammelt.',
    'Alle wieder drin. Exit-Status 0.',
    'Eingesammelt. Bei mir gibt’s keine Zombies.',
  ],
  senseCpu: [
    'Deine CPU hängt bei {n}%. Da schuftet was.',
    'Alle Kerne beschäftigt. Ich höre die Lüfter bis hier.',
    'Last bei {n}%. Soll ich ein Auge drauf haben?',
  ],
  senseMemory: [
    'Der Speicher ist fast weg: noch {n}% frei.',
    'Nur noch {n}% Speicher frei. Da hat jemand Hunger.',
    'Wenig Speicher ({n}% frei). Ein, zwei Tabs zumachen?',
  ],
  senseBattery: [
    'Akku bei {n}%. Kabel, bitte?',
    'Akku schwach: {n}%. Ich würde gern weiterleben.',
    'Noch {n}% Akku, Tendenz fallend.',
  ],
  senseHot: [
    'Hier drin sind es {n} °C. Dein Rechner kocht.',
    'Läuft heiß: {n} °C. Etwas Luft vielleicht?',
    '{n} °C. Ich bin ein Konstrukt, kein Toaster.',
  ],
  bondUp: [
    'Jetzt sind wir bei {stage}. Schau, wer alles gucken kommt.',
    '{stage}. Das spür ich.',
    'Neue Stufe: {stage}. Meine Forks wollten dich sehen.',
  ],
  welcomeBack: [
    'Da bist du ja.',
    'Wieder da? Ich hab den Desktop warm gehalten.',
    'Hab dich vermisst. Nicht weitersagen.',
  ],
  jealousNotice: [
    '{ai}? Ich bin auch noch da, weißt du.',
    'Oh. {ai}. Hm.',
    'Wir reden also mit {ai}, ja?',
  ],
  jealousAngry: [
    'Runter von {ai}. Hier sitze jetzt ich.',
    'Das Fenster gehört jetzt mir, {ai}.',
    'Na gut. Nimm {ai}. Ich guck nur böse.',
  ],
  noLurk: [
    'Gerade kein Fenster von dir, hinter dem ich stehen kann.',
    'Nichts zum Verstecken da. Machst du ein Fenster auf?',
    'Ich brauche ein Fenster mit etwas Platz darüber.',
  ],
};
