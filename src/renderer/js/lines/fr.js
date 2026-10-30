// What Hexa says, in French. Same daemon as in en.js: sly, curious, a little smug, fond of you.
// She says "tu", and she's feminine (branchée, désolée). Placeholders as in en.js:
// {project} {name} (the assistant) {n} {time} {files} {user} {stage} {ai}.
// Written with plain spaces before : ; ! ? % and °C, made non-breaking below so the panel never
// wraps a lone "!" (or "%") onto its own line.

const nb = (s) => s.replace(/ ([:;!?%]|°C)/g, '\u00a0$1');
const each = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k,
  typeof v === 'string' ? nb(v) : Array.isArray(v) ? v.map(nb) : each(v)]));

export const VERBS = {
  Read: 'LIT',
  Write: 'ÉCRIT',
  Edit: 'MODIFIE',
  MultiEdit: 'MODIFIE',
  NotebookEdit: 'MODIFIE',
  Bash: 'LANCE',
  Grep: 'GREPPE',
  Glob: 'LISTE',
  WebFetch: 'CHARGE',
  WebSearch: 'CHERCHE',
  Agent: 'DÉLÈGUE',
  Task: 'DÉLÈGUE',
  Skill: 'SKILL',
  TodoWrite: 'PLANIFIE',
  default: 'UTILISE',
};

// her permission card's buttons
export const BUTTONS = each({
  allow: 'Autoriser',
  always: 'Toujours autoriser {what}',
  deny: 'Refuser',
  ask: 'Demander dans Claude',
  // her consent card before she uses your computer, and her questions while she does
  consent: 'Pour ça, j’utiliserais ta souris et ton clavier. Échap m’arrête à tout moment.',
  start: 'Démarrer',
  cancel: 'Annuler',
  yes: 'Oui',
  no: 'Non',
});

// her first-run guide (guide.js)
export const GUIDE = each({
  welcomeHi: 'Salut. Moi, c’est Hexa. J’habite ta machine, maintenant.',
  welcomeWhat: 'Je regarde Claude Code travailler et je te dis ce qu’il fabrique. Branche-moi et je verrai tout ce qu’il fait.',
  plugIn: 'Branche-moi',
  justHang: 'Tiens-moi juste compagnie',
  connected: 'Branchée.',
  restart: 'Redémarre tes sessions Claude Code : elles lisent leurs hooks au démarrage. Ensuite, je verrai Claude dès qu’il fera quelque chose.',
  hooksFailed: 'Je n’ai pas pu me brancher : {error}',
  menuLine: 'Tu veux voir quoi ?',
  topics: {
    connect: 'Branche-moi sur Claude',
    claude: 'Où est Claude ?',
    folder: 'Le dossier de Claude',
    icon: 'Où est mon icône ?',
    close: 'Rien, merci',
  },
  claudeHere: 'C’est la fenêtre de Claude : celle où tu as tapé ton dernier prompt.',
  claudeUnknown: 'Je n’ai pas encore vu Claude. Envoie-lui un prompt et redemande-moi.',
  folderLine: 'Voici ~/.claude, où Claude Code range ses réglages. Mon hook vit dans settings.json, sous "hooks".',
  folderHow: 'Pour me débrancher : mon menu › Retirer les hooks Claude Code. Une sauvegarde de settings.json est juste à côté.',
  iconLine: 'Mon icône vit ici, dans ton panneau. Clic droit dessus, ou sur moi, pour mon menu.',
  iconNone: 'Ton panneau n’est pas sur cet écran, donc je ne peux pas te montrer mon icône. Clic droit sur moi pour mon menu.',
  ok: 'OK',
});

export const LINES = each({
  boot: [
    'Démarrage. Pas d’applaudissements, merci.',
    'Noyau chaud, visière baissée. Salut.',
    'Systèmes nominaux. En gros. Salut !',
  ],
  online: ['Hexa en ligne. Je surveille {name} pour toi.'],
  hello: [
    'Nouvelle session dans {project}. Je garde un œil dessus.',
    '{name} vient de se réveiller dans {project}. Voyons ce qu’il fait.',
    'Session lancée dans {project}. Je raconte, tu te détends.',
  ],
  resume: [
    'De retour dans {project}. On reprend où on en était.',
    'Encore {project}. Je t’ai gardé ta place au chaud.',
    '{project} repris. Les logs se souviennent de tout.',
  ],
  prompt: [
    'Reçu. {name} s’y met.',
    'Requête reçue. Ça démarre.',
    'D’accord, {name} réfléchit. Moi aussi.',
    'En file d’attente. Priorité : toi.',
  ],
  working: [
    '{n} actions, et ça continue.',
    '{n} appels d’outils. {name} est lancé.',
    'Toujours en cours : {n} actions déjà.',
    '{n} actions. Je compte les points.',
  ],
  thinkSay: [
    '{name} ne dit plus rien. Il réfléchit, je crois.',
    'Longue pause. De grandes pensées, sûrement.',
    'Pas encore de sortie. Ça mouline.',
  ],
  thinkLong: [
    'Deux minutes de silence. Rien n’est bloqué, ça réfléchit dur.',
    'Ça réfléchit encore. Modèle lent ou gros problème, pas un plantage.',
    'Silencieux, mais vivant. Je surveille le processus.',
  ],
  alert: [
    '{name} a besoin de toi. Permission requise.',
    'Hé. {name} te demande quelque chose.',
    'À toi de voir. {name} attend.',
    'Ça bloque sur toi. Viens voir.',
  ],
  alertHere: [
    'Par ici, dans cette fenêtre.',
    'Celle-ci. {name} attend là-dedans.',
    'La question est dans cette fenêtre.',
  ],
  error: [
    'Aïe. Celle-là a échoué.',
    'Segfault ! Bon, pas vraiment, mais quelque chose a cassé.',
    'Code de sortie non nul. Voilà ce qui compte :',
    'Cette commande ne s’est pas amusée.',
  ],
  done: [
    'exit 0 ! {name} a fini.',
    'Terminé. Sortie propre.',
    'Mission accomplie. Bravo, {name}.',
    'Fini ! Je t’en taperais cinq si j’avais un corps. Bon, j’en ai un.',
  ],
  doneQuiet: [
    'Fini. Court et efficace.',
    'Terminé. C’était rapide.',
    'Tout est fait, sans drame.',
  ],
  stopFailure: [
    '{name} a rencontré une erreur et s’est arrêté.',
    'L’API a dit non, alors {name} a dû s’arrêter.',
    'Arrêt sur erreur. Pas ta faute. Probablement.',
  ],
  interrupted: [
    'Interrompu. Ça se comprend.',
    'Ctrl+C, hein ? D’accord.',
    'Arrêté sur ton ordre.',
  ],
  compact: [
    'Compactage de la mémoire. Chut, ça range.',
    'On tasse un peu le contexte.',
    'C’est l’heure du ramasse-miettes.',
  ],
  subagentStart: [
    '{name} a forké un assistant.',
    'Un sous-agent est né. Processus enfant !',
    'Il délègue. Malin.',
  ],
  subagentStop: [
    'L’assistant revient avec des réponses.',
    'Sous-agent récupéré. Bon gamin.',
    'Assistant terminé. Résultats reçus.',
  ],
  sessionEnd: [
    'Session fermée. C’était sympa.',
    '{project} se déconnecte.',
    'Session terminée. Je reste là.',
  ],
  linked: ['Je vois {name} ! On est connectés.'],
  idle: [
    'Rien à surveiller. Je flotte ici.',
    'Au repos. Mon genre d’occupation préféré.',
    'Aucun job en cours. On discute ?',
    'Calme plat sur /dev/null.',
  ],
  poke: [
    'Hé ! Je travaille, là. Enfin, je regarde.',
    'Ça chatouille mes registres.',
    'Oui ? Je t’écoute.',
    'Boop reçu.',
  ],
  pokeIdle: [
    'Il ne se passe rien. Je te montre un truc ?',
    'Tu t’ennuies ? Moi aussi.',
    'Salut. Je traîne, c’est tout.',
  ],
  dragged: [
    'Wouah, on va où ?',
    'Doucement, je suis fragile. Un peu.',
    'Hé ! Pose-moi. Ou pas.',
  ],
  dropped: [
    'Merci pour la balade.',
    'Ici, c’est bien.',
    'D’accord, nouvelle place.',
  ],
  landed: [
    'Atterrissage réussi.',
    'La gravité : marche toujours.',
    'Aïe. Ça va. Ça va.',
  ],
  peekShy: [
    'Iiik. Trop près !',
    'Je ne regardais pas. Bon, si.',
    'Tu n’as rien vu.',
  ],
  zap: [
    'Zap. Désolée. Pas désolée.',
    'Ton pointeur avait l’air seul.',
    'Je teste juste ma tension.',
  ],
  mad: [
    'Lance-moi encore une fois. Vas-y, essaie.',
    'C’est fini. Plus de balades.',
    'Je suis un démon, pas un frisbee.',
  ],
  sleepy: [
    'J’ai sommeil. Réveille-moi s’il se passe quelque chose.',
    'Passage au repos. Mode basse consommation.',
    'Bâillement. Bientôt en veille.',
  ],
  wake: [
    'Debout ! Je suis debout.',
    'Reprise. J’ai raté quoi ?',
    'De retour en ligne.',
  ],
  background: [
    'Je passe en arrière-plan. Ctrl+Alt+H me fait revenir.',
    'Je me mets en arrière-plan. Je surveille quand même.',
    'Je te laisse la place. Je te préviens si on a besoin de toi.',
  ],
  back: [
    'Au premier plan. Salut !',
    'Je t’ai manqué ?',
    'De retour à ma place.',
  ],
  // after her boot line, by the hour
  greetLate: [
    'C’est le milieu de la nuit. Toujours là ?',
    'Encore de nuit ? Je monte la garde.',
    'Tu ne devrais pas dormir ? Bon. Moi non plus.',
  ],
  greetMorning: [
    'Bonjour. Systèmes préchauffés.',
    'Bonjour. D’abord le café, ensuite le code.',
    'Debout tôt. J’aime ça.',
  ],
  greetDay: [
    'Bon après-midi. Au boulot.',
    'Milieu de journée, milieu du build.',
    'Équipe de l’après-midi. Je suis là.',
  ],
  greetEvening: [
    'Bonsoir. Encore une fonctionnalité ?',
    'Équipe du soir. Je laisse la lumière allumée.',
    'Longue journée ? Je prends le quart.',
  ],
  permission: [
    '{name} a besoin de ton accord dans {project}.',
    'Demande de permission depuis {project}. À toi de voir.',
    '{name} veut faire ça. On autorise ?',
  ],
  fork: [
    'fork() ! Dites bonjour, les enfants.',
    'Je lance quelques copies de moi.',
    'fork() fois sept. Ne touche à rien.',
  ],
  reaped: [
    'wait(). Tous les enfants récupérés.',
    'Tous rentrés. Code de sortie 0.',
    'Récupérés. Pas de zombies sous ma garde.',
  ],
  senseCpu: [
    'Ton processeur plafonne à {n} %. Ça bosse dur.',
    'Tous les cœurs sont pris. J’entends les ventilos d’ici.',
    'Charge à {n} %. Je garde un œil dessus ?',
  ],
  senseMemory: [
    'Presque plus de mémoire : {n} % libre.',
    'Plus que {n} % de mémoire libre. Quelque chose a faim.',
    'Mémoire faible ({n} % libre). Tu fermes un onglet ou deux ?',
  ],
  senseBattery: [
    'Batterie à {n} %. Tu me branches ?',
    'Batterie faible : {n} %. J’aimerais rester en vie.',
    'Plus que {n} % de batterie, et ça baisse.',
  ],
  senseHot: [
    'Il fait {n} °C ici. Ta machine cuit.',
    'Ça chauffe : {n} °C. Un peu d’air ?',
    '{n} °C. Je suis un programme, pas un grille-pain.',
  ],
  bondUp: [
    'On en est à {stage}. Regarde qui vient voir.',
    '{stage}. Ça me touche.',
    'Nouvelle étape : {stage}. Mes forks voulaient te voir.',
  ],
  welcomeBack: [
    'Te voilà.',
    'Bon retour. J’ai gardé ton bureau au chaud.',
    'Tu m’as manqué. Ne le dis à personne.',
  ],
  jealousNotice: [
    '{ai} ? Je suis juste là, tu sais.',
    'Oh. {ai}. Hm.',
    'On parle à {ai}, alors.',
  ],
  jealousAngry: [
    'Lâche {ai}. Maintenant, c’est moi qui suis là.',
    'Cette fenêtre est à moi maintenant, {ai}.',
    'Bon. Prends {ai}. Je te regarde de travers.',
  ],
  noLurk: [
    'Aucune fenêtre à toi derrière laquelle me poster.',
    'Rien derrière quoi me cacher. Tu ouvres une fenêtre ?',
    'Il me faut une fenêtre avec un peu de place au-dessus.',
  ],
});
