// What Hexa says, in English. She's a daemon who decided to be seen: sly, curious, a little smug,
// fond of you, proud of her machine. Short lines, Unix jokes you don't need to know to get.
// Placeholders: {project} {name} (the assistant) {n} {time} {files} {user}.

export const VERBS = {
  Read: 'READS',
  Write: 'WRITES',
  Edit: 'EDITS',
  MultiEdit: 'EDITS',
  NotebookEdit: 'EDITS',
  Bash: 'RUNS',
  Grep: 'GREPS',
  Glob: 'GLOBS',
  WebFetch: 'FETCHES',
  WebSearch: 'SEARCHES',
  Agent: 'DELEGATES',
  Task: 'DELEGATES',
  Skill: 'SKILL',
  TodoWrite: 'PLANS',
  default: 'USES',
};

export const LINES = {
  boot: [
    'Booting. Hold your applause.',
    'Kernel warm, visor on. Hi.',
    'All systems nominal. Mostly. Hi!',
  ],
  online: ['Hexa online. Watching {name} for you.'],
  hello: [
    'New session in {project}. I have my eye on it.',
    '{name} just woke up in {project}. Let\'s see what it does.',
    'Session up in {project}. I narrate, you relax.',
  ],
  resume: [
    'Back in {project}. Picking up where we left off.',
    '{project} again. I kept your seat warm.',
    'Resumed {project}. The logs remember everything.',
  ],
  prompt: [
    'Got it. {name} is on the job.',
    'Request received. Spinning up.',
    'Okay, {name} is thinking about it. So am I.',
    'Queued. Priority: you.',
  ],
  working: [
    '{n} actions in and counting.',
    '{n} tool calls. {name} is on a roll.',
    'Still going: {n} actions so far.',
    '{n} actions. I\'m keeping score.',
  ],
  thinkSay: [
    '{name} went quiet. Thinking, I think.',
    'Long pause. Big thoughts, probably.',
    'No output yet. It\'s chewing on something.',
  ],
  thinkLong: [
    'Two minutes of quiet. Nothing\'s stuck, it\'s thinking hard.',
    'Still thinking. Slow model or big problem, not a crash.',
    'Quiet, but alive. I\'m watching the process.',
  ],
  alert: [
    '{name} needs you. Permission time.',
    'Hey. {name} is asking you something.',
    'Your call. {name} is waiting.',
    'Blocked on you. Come and look.',
  ],
  alertHere: [
    'Over here, in this window.',
    'This one. {name} is waiting in here.',
    'The question is in this window.',
  ],
  error: [
    'Ow. That one failed.',
    'Segfault! Okay, not really, but something broke.',
    'Non-zero exit. Here\'s the part that matters:',
    'That command did not enjoy itself.',
  ],
  done: [
    'exit 0! {name} finished.',
    'Done. Clean exit.',
    'Job complete. Take a bow, {name}.',
    'Finished! I\'d high-five you if I had a body. I sort of do.',
  ],
  doneQuiet: [
    'Done. Short and sweet.',
    'Finished. That was quick.',
    'All done, nothing dramatic.',
  ],
  stopFailure: [
    '{name} hit an error and stopped.',
    'The API said no, so {name} had to stop.',
    'Stopped on an error. Not your fault. Probably.',
  ],
  interrupted: [
    'Interrupted. Fair enough.',
    'Ctrl+C, huh? Okay.',
    'Stopped on your word.',
  ],
  compact: [
    'Compacting memory. Shh, it\'s tidying up.',
    'Squeezing the context down a little.',
    'Garbage collection time.',
  ],
  subagentStart: [
    '{name} forked a helper.',
    'A subagent spawned. Child process!',
    'Delegating. Smart.',
  ],
  subagentStop: [
    'The helper is back with answers.',
    'Subagent reaped. Good kid.',
    'Helper done. Results in.',
  ],
  sessionEnd: [
    'Session closed. That was fun.',
    '{project} signing off.',
    'Session over. I\'ll be here.',
  ],
  linked: ['I can see {name}! We\'re connected.'],
  idle: [
    'Nothing to watch. I\'ll float here.',
    'Idle. My favourite kind of busy.',
    'No jobs running. Want to talk?',
    'All quiet on /dev/null.',
  ],
  poke: [
    'Hey! I\'m working here. Well, watching.',
    'That tickles my registers.',
    'Yes? I\'m listening.',
    'Boop received.',
  ],
  pokeIdle: [
    'Nothing going on. Want me to show you something?',
    'Bored? Me too.',
    'Hi, {user}. Just hanging out.',
  ],
  dragged: [
    'Whoa, where are we going?',
    'Careful, I\'m fragile. Ish.',
    'Hey! Put me down. Or don\'t.',
  ],
  dropped: [
    'Thanks for the ride.',
    'Here is fine.',
    'Okay, new spot.',
  ],
  landed: [
    'Stuck the landing.',
    'Gravity: still works.',
    'Ow. I\'m fine. I\'m fine.',
  ],
  peekShy: [
    'Eep. Too close!',
    'I wasn\'t peeking. Okay, I was.',
    'You saw nothing.',
  ],
  zap: [
    'Zap. Sorry. Not sorry.',
    'Your pointer looked lonely.',
    'Just testing my voltage.',
  ],
  sleepy: [
    'Getting sleepy. Wake me if anything happens.',
    'Going idle. Low-power mode.',
    'Yawn. Suspending soon.',
  ],
  wake: [
    'I\'m up! I\'m up.',
    'Resumed. What did I miss?',
    'Back online.',
  ],
  background: [
    'Going to the background. Ctrl+Alt+H brings me back.',
    'Backgrounding myself. I\'ll still watch.',
    'Out of your way. I\'ll ping you if you\'re needed.',
  ],
  back: [
    'Foreground again. Hi!',
    'Missed me?',
    'Back where I belong.',
  ],
};
