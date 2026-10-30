// Her Mainframe: the panel she stands on when you talk to her. Chat (a terminal-style transcript,
// "> you:" and "HEXA:", and a line to type in), and her Brain (which brain runs: a small or a
// bigger local model, or Claude; its model; your API key; whether she may use your computer).
// While you type in it the overlay holds the keyboard (main gives it back when you're done).
// Everything shown goes in as text.

const TIERS = [
  { id: 'normal', name: 'NORMAL', note: 'Free · a small local model (Ollama)', tag: 'Start with this' },
  { id: 'bigger', name: 'BIGGER', note: 'Free · a bigger local model (Ollama)', tag: '' },
  { id: 'max', name: 'MAX INTELLIGENCE', note: 'Claude, with your API key', tag: 'Can do things' },
];

export class Mainframe {
  constructor({ doc = document, root, host, onOpen = () => {}, onClose = () => {} }) {
    this.doc = doc;
    this.host = host;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.open = false;
    this.tab = 'chat';
    this.status = null;
    this.reply = null; // her reply line while it streams

    const el = (tag, className, text) => {
      const n = doc.createElement(tag);
      if (className) n.className = className;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    this.el = el;
    this.box = el('div', 'mainframe');
    this.box.hidden = true;
    const head = el('div', 'mf-head');
    head.append(el('span', 'mf-title', 'MAINFRAME'));
    this.tabs = {};
    for (const t of ['chat', 'brain']) {
      const b = el('button', 'mf-tab', t === 'chat' ? 'Chat' : 'Brain');
      b.type = 'button';
      b.addEventListener('click', () => this.show(t));
      this.tabs[t] = b;
      head.append(b);
    }
    const close = el('button', 'mf-close', '×');
    close.type = 'button';
    close.title = 'Close (Esc)';
    close.addEventListener('click', () => this.close());
    head.append(close);

    // chat
    this.chatPane = el('div', 'mf-pane');
    this.log = el('div', 'mf-log');
    const row = el('form', 'mf-row');
    row.append(el('span', 'mf-prompt', '>'));
    this.input = el('input', 'mf-input');
    this.input.placeholder = 'talk to me…';
    this.input.maxLength = 4000;
    this.input.spellcheck = false;
    row.append(this.input);
    row.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    const fresh = el('button', 'mf-small', 'new chat');
    fresh.type = 'button';
    fresh.addEventListener('click', () => {
      this.host.chatReset();
      this.log.replaceChildren();
      this.line('sys', 'new chat');
    });
    this.chatPane.append(this.log, row, fresh);

    // brain
    this.brainPane = el('div', 'mf-pane');
    this.brainPane.append(el('div', 'mf-hint', 'Pick one. Only one brain runs at a time.'));
    this.tierRows = {};
    for (const t of TIERS) {
      const r = el('label', 'mf-tier');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'mf-tier';
      radio.addEventListener('change', () => this.pick(t.id));
      const text = el('span', 'mf-tier-text');
      text.append(el('b', '', t.name), el('span', 'mf-note', t.note));
      r.append(radio, text, el('span', 'mf-tag', t.tag));
      this.tierRows[t.id] = { row: r, radio };
      this.brainPane.append(r);
    }
    const modelRow = el('div', 'mf-row');
    this.model = el('select', 'mf-select');
    this.model.addEventListener('change', () => this.host.brainSet({ tier: this.status?.brain, model: this.model.value }));
    const refresh = el('button', 'mf-small', 'Refresh');
    refresh.type = 'button';
    refresh.addEventListener('click', () => this.loadModels());
    modelRow.append(this.model, refresh);
    this.keyRow = el('form', 'mf-row');
    this.key = el('input', 'mf-input');
    this.key.type = 'password';
    this.key.placeholder = 'sk-ant-… (or ANTHROPIC_API_KEY / ant auth login)';
    const save = el('button', 'mf-small', 'Save key');
    save.type = 'submit';
    const forget = el('button', 'mf-small', 'Forget');
    forget.type = 'button';
    forget.addEventListener('click', async () => {
      await this.host.brainKey('');
      this.refresh();
    });
    this.keyRow.append(this.key, save, forget);
    this.keyRow.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await this.host.brainKey(this.key.value);
      this.key.value = '';
      this.note(r.ok ? 'Key saved, in your keyring.' : r.error);
      this.refresh();
    });
    const computer = el('label', 'mf-check');
    this.computer = el('input');
    this.computer.type = 'checkbox';
    this.computer.addEventListener('change', () => this.host.brainSet({ computerUse: this.computer.checked }).then((s) => this.render(s)));
    computer.append(this.computer, el('span', '', 'Let her use my computer (mouse and keyboard, Claude only). She asks first, every time, and Esc stops her.'));
    this.notice = el('div', 'mf-hint');
    this.brainPane.append(modelRow, this.keyRow, computer, this.notice);

    this.box.append(head, this.chatPane, this.brainPane);
    root.appendChild(this.box);

    // typing to her: the overlay takes the keyboard while one of these has the caret
    for (const field of [this.input, this.key, this.model]) {
      field.addEventListener('pointerdown', () => this.host.takeFocus());
      field.addEventListener('focus', () => this.host.takeFocus());
    }
    this.box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  async toggle() {
    if (this.open) this.close();
    else await this.show(this.tab);
  }

  async show(tab = 'chat') {
    this.tab = tab;
    this.open = true;
    this.box.hidden = false;
    this.chatPane.hidden = tab !== 'chat';
    this.brainPane.hidden = tab !== 'brain';
    for (const [t, b] of Object.entries(this.tabs)) b.classList.toggle('on', t === tab);
    this.onOpen();
    await this.refresh();
    if (tab === 'brain') this.loadModels();
    if (tab === 'chat') {
      await this.host.takeFocus();
      this.input.focus();
    }
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.box.hidden = true;
    this.host.giveFocus();
    this.onClose();
  }

  async refresh() {
    this.render(await this.host.brainStatus());
  }

  render(s) {
    this.status = s;
    for (const t of TIERS) {
      this.tierRows[t.id].radio.checked = s.brain === t.id;
      this.tierRows[t.id].row.classList.toggle('on', s.brain === t.id);
    }
    this.keyRow.hidden = s.brain !== 'max';
    this.computer.checked = s.computerUse;
    this.computer.disabled = !s.canUseComputer;
    if (s.brain === 'max' && !s.hasKey) this.note('No key saved: she\'ll use ANTHROPIC_API_KEY or your `ant auth login` profile if you have one.');
  }

  note(text) {
    this.notice.textContent = text || '';
  }

  async pick(tier) {
    this.render(await this.host.brainSet({ brain: tier }));
    this.loadModels();
  }

  async loadModels() {
    const tier = this.status?.brain;
    const list = await this.host.brainModels(tier);
    this.model.replaceChildren();
    if (!Array.isArray(list)) {
      this.note(list?.error || 'Couldn\'t list the models.');
      return;
    }
    const chosen = this.status?.models?.[tier];
    for (const m of list) {
      const o = this.el('option', '', m.label);
      o.value = m.id;
      if (m.id === chosen) o.selected = true;
      this.model.append(o);
    }
    if (!list.length) this.note(tier === 'max' ? 'No models: is your key right?' : 'No local models: install Ollama, then `ollama pull llama3.2`.');
  }

  submit() {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.line('you', text);
    this.host.chatSend(text);
  }

  line(who, text) {
    const row = this.el('div', `mf-line mf-${who}`);
    row.append(this.el('span', 'mf-who', who === 'you' ? '> you:' : who === 'sys' ? '> sys:' : 'HEXA:'), this.el('span', 'mf-text', text));
    this.log.append(row);
    while (this.log.children.length > 200) this.log.firstChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
    return row.lastChild;
  }

  // the chat's events from main: her reply streaming in, her actions, the end
  onChat(e) {
    if (e.type === 'start') this.reply = null;
    else if (e.type === 'delta') {
      if (!this.reply) this.reply = this.line('hexa', '');
      this.reply.textContent += e.text;
      this.log.scrollTop = this.log.scrollHeight;
    } else if (e.type === 'action') this.line('sys', e.label);
    else if (e.type === 'done') {
      if (!this.reply && e.text) this.line('hexa', e.text);
      if (e.refused) this.line('sys', 'she declined that one');
      this.reply = null;
    } else if (e.type === 'error') this.line('sys', e.text);
    else if (e.type === 'stopped') this.line('sys', 'stopped');
  }

  // where clicks must reach it
  rects() {
    if (!this.open) return [];
    const b = this.box.getBoundingClientRect();
    return [[b.left, b.top, b.width, b.height]];
  }

  get top() {
    return this.box.getBoundingClientRect().top;
  }
}

// Her task card while she uses your computer: the task, her last few steps, how to stop her.
export class TaskCard {
  constructor({ doc = document, root }) {
    this.doc = doc;
    this.box = doc.createElement('div');
    this.box.className = 'taskcard';
    this.box.hidden = true;
    root.appendChild(this.box);
    this.steps = [];
  }

  start(task) {
    this.steps = [];
    this.task = task;
    this.box.hidden = false;
    this.draw('working on your task');
  }

  step(s) {
    this.steps.push(s);
    this.draw(s.kind === 'ask' ? 'asking you' : 'working on your task');
  }

  end(out) {
    this.draw(out.outcome === 'done' ? 'done' : out.outcome === 'stopped' ? 'stopped' : 'stopped here');
    setTimeout(() => { this.box.hidden = true; }, 6000);
  }

  draw(state) {
    const el = (tag, className, text) => {
      const n = this.doc.createElement(tag);
      n.className = className;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const head = el('div', 'tc-head');
    head.append(el('span', 'tc-who', 'HEXA:'), el('span', 'tc-state', state), el('span', 'tc-esc', 'Esc stops me'));
    const task = el('div', 'tc-task', `> you: ${this.task}`);
    const list = el('div', 'tc-steps');
    const recent = this.steps.slice(-5);
    if (this.steps.length > 5) list.append(el('div', 'tc-more', `+${this.steps.length - 5} earlier steps`));
    for (const s of recent) list.append(el('div', `tc-step tc-${s.kind}`, s.text));
    this.box.replaceChildren(head, task, list);
  }
}
