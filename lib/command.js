/**
 * Присоединяется к чату, порождает pty, присоединяет к эмулятору терминала
 * и средство визуализации и управляет ими. Обрабатывает входящие команды и ввод,
 * и публикует дополнительные сообщения, такие как сама команда и выходной код.
 **/

var util = require("util");
var escapeHtml = require("escape-html");
var pty = require("node-pty");
var termios = require("node-termios");
var utils = require("./utils");
var terminal = require("./terminal");
var renderer = require("./renderer");
var tsyms = termios.native.ALL_SYMBOLS;

function Command(reply, context, command) {
  var toUser = reply.destination > 0;

  this.startTime = Date.now();
  this.reply = reply;
  this.command = command;
  this.pty = pty.spawn(context.shell, [context.interactive ? "-ic" : "-c", command], {
    cols: context.size.columns,
    rows: context.size.rows,
    cwd: context.cwd,
    env: context.env,
  });
  this.termios = new termios.Termios(this.pty._fd);
  this.termios.c_lflag &= ~(tsyms.ISIG | tsyms.IEXTEN);
  this.termios.c_lflag &= ~tsyms.ECHO; // отключить ECHO
  this.termios.c_lflag |= tsyms.ICANON | tsyms.ECHONL; // он нам нужен для / end, он должен быть активен заранее
  this.termios.c_iflag = (this.termios.c_iflag & ~(tsyms.INLCR | tsyms.IGNCR)) | tsyms.ICRNL; // CR to NL
  this.termios.writeTo(this.pty._fd);

  this.terminal = terminal.createTerminal({
    columns: context.size.columns,
    rows: context.size.rows,
  });
  this.state = this.terminal.state;
  this.renderer = new renderer.Renderer(reply, this.state, {
    cursorString: "\uD83D\uDD38",
    cursorBlinkString: "\uD83D\uDD38",
    hidePreview: !context.linkPreviews,
    unfinishedHidePreview: true,
    silent: context.silent,
    unfinishedSilent: true,
    maxLinesWait: toUser ? 20 : 30,
    maxLinesEmitted: 30,
    lineTime: toUser ? 400 : 1200,
    chunkTime: toUser ? 3000 : 6000,
    editTime: toUser ? 300 : 2500,
    unfinishedTime: toUser ? 1000 : 2000,
    startFill: "·  ",
  });
  this._initKeypad();
  // FIXME: предпринять дополнительные шаги для уменьшения количества сообщений, отправляемых в группу. считаются ли действия при вводе текста?

  // Опубликовать начальное сообщение
  this.initialMessage = new utils.EditedMessage(reply, this._renderInitial(), "HTML");

  // Вывод команды процесса
  this.pty.on("data", this._ptyData.bind(this));

  //Обработка выхода из команды
  this.pty.on("exit", this._exit.bind(this));
}
util.inherits(Command, require("events").EventEmitter);

Command.prototype._renderInitial = function _renderInitial() {
  var content = "", title = this.state.metas.title, badges = this.badges || "";
  if (title) {
    content += "<strong>" + escapeHtml(title) + "</strong>\n";
    content += badges + "<strong>$</strong> " + escapeHtml(this.command);
  } else {
    content += badges + "<strong>$ " + escapeHtml(this.command) + "</strong>";
  }
  return content;
}

Command.prototype._ptyData = function _ptyData(chunk) {
  // FIXME: реализовать некоторое противодавление, например, прочитать меньшие фрагменты, прекратить чтение, если есть> = 20 строк, ожидающих отправки, установите HWM
  if ((typeof chunk !== "string") && !(chunk instanceof String))
    throw new Error("Expected a String, you liar.");
  this.interacted = true;
  this.terminal.write(chunk, "utf-8", this._update.bind(this));
};

Command.prototype._update = function _update() {
  this.initialMessage.edit(this._renderInitial());
  this.renderer.update();
};

Command.prototype.resize = function resize(size) {
  this.interacted = true;
  this.metaActive = true;
  this.state.resize(size);
  this._update();
  this.pty.resize(size.columns, size.rows);
};

Command.prototype.redraw = function redraw() {
  this.interacted = true;
  this.metaActive = true;
  this.pty.redraw();
};

Command.prototype.sendSignal = function sendSignal(signal, group) {
  this.interacted = true;
  this.metaActive = false;
  var pid = this.pty.pid;
  if (group) pid = -pid;
  process.kill(pid, signal);
};

Command.prototype.sendEof = function sendEof() {
  this.interacted = true;
  this.metaActive = true;

// Я не знаю, как вызвать «сброс буфера в приложение» (эффект Control + D)
  // не вдавливая его в консоль. Так что давайте сделаем это.
  // TTY должен быть в режиме ICANON с самого начала, включение его сейчас не работает

  // записываем управляющий символ EOF
  this.termios.loadFrom(this.pty._fd);
  this.pty.write(Buffer.from([ this.termios.c_cc[tsyms.VEOF] ]));
};

Command.prototype._exit = function _exit(code, signal) {
  this._update();
  this.renderer.flushUnfinished();


// FIXME: можно дождаться, пока будут внесены все изменения, прежде чем публиковать закрытое сообщение
  if ((Date.now() - this.startTime) < 2000 && !signal && code === 0 && !this.interacted) {
// Для короткоживущих команд, которые завершились без вывода, мы просто добавляем галочку к исходному сообщению    this.badges = "\u2705 ";
    this.initialMessage.edit(this._renderInitial());
  } else {
    if (signal)
      this.reply.html("\uD83D\uDC80 <strong>Killed</strong> by %s.", utils.formatSignal(signal));
    else if (code === 0)
      this.reply.html("\u2705 <strong>Exited</strong> correctly.");
    else
      this.reply.html("\u26D4 <strong>Exited</strong> with %s.", code);
  }

  this._removeKeypad();
  this.emit("exit");
};

Command.prototype.handleReply = function handleReply(msg) {
 // FIXME: функция: если фото, файл, видео, голос или музыка, перевести терминал в необработанный режим, отложить дальнейший ввод, направить двоичный ресурс в терминал, восстановить
  // Флаги, которые нам нужно коснуться: -INLCR -IGNCR -ICRNL -IUCLC -ISIG -ICANON -IEXTEN, а также для удобства -ECHO -ECHONL
  if (msg.type !== "text") true;
  this.sendInput(msg.text);
};

Command.prototype.sendInput = function sendInput(text, noTerminate) {
  this.interacted = false;
  text = text.replace(/\n/g, "\r");
  if (!noTerminate) text += " ";
  if (this.metaActive) text = "\x1b" + text;
  this.pty.write(text);
  this.metaActive = true;
};

Command.prototype.toggleMeta = function toggleMeta(metaActive) {
  if (metaActive === undefined) metaActive = !this.metaActive;
  this.metaActive = metaActive;
};

Command.prototype.setSilent = function setSilent(silent) {
  this.renderer.options.silent = silent;
};

Command.prototype.setLinkPreviews = function setLinkPreviews(linkPreviews) {
  this.renderer.options.hidePreview = !linkPreviews;
};

Command.prototype._initKeypad = function _initKeypad() {
  this.keypadToken = utils.generateToken();

  var keys = {
    esc:       { label: "ESC", content: "\x1b" },
    tab:       { label: "⇥", content: "\t" },
    enter:     { label: "⏎", content: "\r" },
    backspace: { label: "↤", content: "\x7F" },
    space:     { label: " ", content: " " },

    up:        { label: "↑", content: "\x1b[A", appKeypadContent: "\x1bOA" },
    down:      { label: "↓", content: "\x1b[B", appKeypadContent: "\x1bOB" },
    right:     { label: "→", content: "\x1b[C", appKeypadContent: "\x1bOC" },
    left:      { label: "←", content: "\x1b[D", appKeypadContent: "\x1bOD" },

    insert:    { label: "INS", content: "\x1b[2~" },
    del:       { label: "DEL", content: "\x1b[3~" },
    home:      { label: "⇱", content: "\x1bOH" },
    end:       { label: "⇲", content: "\x1bOF" },

    prevPage:  { label: "⇈", content: "\x1b[5~" },
    nextPage:  { label: "⇊", content: "\x1b[6~" },
  };

  var keypad = [
    [ "esc",  "up",    "backspace", "del"  ],
    [ "left", "space", "right",     "home" ],
    [ "tab",  "down",  "enter",     "end"  ],
  ];

  this.buttons = [];
  this.inlineKeyboard = keypad.map(function (row) {
    return row.map(function (name) {
      var button = keys[name];
      var data = JSON.stringify({ token: this.keypadToken, button: this.buttons.length });
      var keyboardButton = { text: button.label, callback_data: data };
      this.buttons.push(button);
      return keyboardButton;
    }.bind(this));
  }.bind(this));

  this.reply.bot.callback(function (query, next) {
    try {
      var data = JSON.parse(query.data);
    } catch (e) { return next(); }
    if (data.token !== this.keypadToken) return next();
    this._keypadPressed(data.button, query);
  }.bind(this));
};

Command.prototype.toggleKeypad = function toggleKeypad() {
  if (this.keypadMessage) {
    this.keypadMessage.markup = null;
    this.keypadMessage.refresh();
    this.keypadMessage = null;
    return;
  }

 // FIXME: это довольно плохо реализовано, мы должны дождаться, пока последнее сообщение (или сообщение с курсором) не получит известный идентификатор
  var messages = this.renderer.messages;
  var msg = messages[messages.length - 1].ref;
  msg.markup = {inline_keyboard: this.inlineKeyboard};
  msg.refresh();
  this.keypadMessage = msg;
};

Command.prototype._keypadPressed = function _keypadPressed(id, query) {
  this.interacted = true;
  if (typeof id !== "number" || !(id in this.buttons)) return;
  var button = this.buttons[id];
  var content = button.content;
  if (button.appKeypadContent !== undefined && this.state.getMode("appKeypad"))
    content = button.appKeypadContent;
  this.pty.write(content);
  query.answer();
};

Command.prototype._removeKeypad = function _removeKeypad() {
  if (this.keypadMessage) this.toggleKeypad();
};



exports.Command = Command;
