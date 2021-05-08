/**
 * Разные утилиты.
 **/

var fs = require("fs");
var util = require("util");
var mime = require("mime");
var crypto = require("crypto");
var url = require("url");


/** ТАЙМЕР **/

function Timer(delay) {
  this.delay = delay;
}
util.inherits(Timer, require("events").EventEmitter);

/ * Запускает таймер, ничего не делает, если он уже запущен. * /
Timer.prototype.set = function set() {
  if (this.timeout) return;
  this.timeout = setTimeout(function () {
    this.timeout = null;
    this.emit("fire");
  }.bind(this), this.delay);
  this.emit("active");
};

/ * Отменяет таймер, если установлен. * /
Timer.prototype.cancel = function cancel() {
  if (!this.timeout) return;
  clearTimeout(this.timeout);
  delete this.timeout;
};

/ * Запускает таймер, сначала отменяя его, если он установлен. * /
Timer.prototype.reset = function reset() {
  this.cancel();
  this.set();
};

/** ОТРЕДАКТИРОВАННОЕ СООБЩЕНИЕ **/

function EditedMessage(reply, text, mode) {
  this.reply = reply;
  this.mode = mode;

  this.lastText = text;
  this.markup = reply.parameters["reply_markup"];
  this.disablePreview = reply.parameters["disable_web_page_preview"];
  this.text = text;
  this.callbacks = [];
  this.pendingText = null;
  this.pendingCallbacks = [];

  this.idPromise = new Promise(function (resolve, reject) {
    reply.text(this.text, this.mode).then(function (err, msg) {
      if (err) reject(err);
      else resolve(msg.id);
      this._whenEdited(err, msg);
    }.bind(this));
  }.bind(this));
}
util.inherits(EditedMessage, require("events").EventEmitter);

EditedMessage.prototype.refresh = function refresh(callback) {
  if (callback) this.pendingCallbacks.push(callback);
  this.pendingText = this.lastText;
  if (this.callbacks === undefined) this._flushEdit();
};

EditedMessage.prototype.edit = function edit(text, callback) {
  this.lastText = text;
  var idle = this.callbacks === undefined;
  if (callback) this.pendingCallbacks.push(callback);

  if (text === this.text) {
    this.callbacks = (this.callbacks || []).concat(this.pendingCallbacks);
    this.pendingText = null;
    this.pendingCallbacks = [];
    if (idle) this._whenEdited();
  } else {
    this.pendingText = text;
    if (idle) this._flushEdit();
  }
};

EditedMessage.prototype._flushEdit = function _flushEdit() {
  this.text = this.pendingText;
  this.callbacks = this.pendingCallbacks;
  this.pendingText = null;
  this.pendingCallbacks = [];
  this.reply.parameters["reply_markup"] = this.markup;
  this.reply.parameters["disable_web_page_preview"] = this.disablePreview;
  this.reply.editText(this.id, this.text, this.mode).then(this._whenEdited.bind(this));
};

EditedMessage.prototype._whenEdited = function _whenEdited(err, msg) {
  if (err) this.emit(this.id === undefined ? "error" : "editError", err);
  if (this.id === undefined) this.id = msg.id;
  var callbacks = this.callbacks;
  delete this.callbacks;
  callbacks.forEach(function (callback) { callback(); });
  if (this.pendingText !== null) this._flushEdit();
};

/ ** САНИТИЗИРОВАННАЯ СРЕДА ** /

function getSanitizedEnv() {
// Адаптировано из источника pty.js
  var env = {};
  Object.keys(process.env).forEach(function (key) {
    env[key] = process.env[key];
  });

// Убедитесь, что мы не запустили наш
  // сервер изнутри tmux.
  delete env.TMUX;
  delete env.TMUX_PANE;

// Убедитесь, что мы не запустили
  // наш сервер изнутри экрана.
  // http://web.mit.edu/gnu/doc/html/screen_20.html
  delete env.STY;
  delete env.WINDOW;

// Удаляем некоторые переменные, которые
  // может запутать наш терминал.
  delete env.WINDOWID;
  delete env.TERMCAP;
  delete env.COLUMNS;
  delete env.LINES;
// Установить $ TERM на экран. Это отключает мультиплексоры
  // которые имеют перехватчики входа, например byobu.
  env.TERM = "screen";

  return env;
}

/** РАЗРЕШИТЬ СИГНАЛ **/

var SIGNALS = "HUP INT QUIT ILL TRAP ABRT BUS FPE KILL USR1 SEGV USR2 PIPE ALRM TERM STKFLT CHLD CONT STOP TSTP TTIN TTOU URG XCPU XFSZ VTALRM PROF WINCH POLL PWR SYS".split(" ");

function formatSignal(signal) {
  signal--;
  if (signal in SIGNALS) return "SIG" + SIGNALS[signal];
  return "unknown signal " + signal;
}

/** ОБОЛОЧКИ **/

function getShells() {
  var lines = fs.readFileSync("/etc/shells", "utf-8").split("\n")
  var shells = lines.map(function (line) { return line.split("#")[0]; })
    .filter(function (line) { return line.trim().length; });
  // Добавьте process.env.SHELL на позицию # 1
  var shell = process.env.SHELL;
  if (shell) {
    var idx = shells.indexOf(shell);
    if (idx !== -1) shells.splice(idx, 1);
    shells.unshift(shell);
  }
  return shells;
}

var shells = getShells();

/** РАЗРЕШИТЬ ОБОЛОЧКИ **/

function resolveShell(shell) {
  return shell; // TODO: если найдено в списке, в противном случае решить, с каким и проверить доступ
}

/** ГЕНЕРАЦИЯ ТОКЕНОВ **/

function generateToken() {
  return crypto.randomBytes(12).toString("hex");
}

/** РАЗРЕШИТЬ BOOLEAN **/

var BOOLEANS = {
  "yes": true, "no": false,
  "y": true, "n": false,
  "on": true, "off": false,
  "enable": true, "disable": false,
  "enabled": true, "disabled": false,
  "active": true, "inactive": false,
  "true": true, "false": false,
};

function resolveBoolean(arg) {
  arg = arg.trim().toLowerCase();
  if (!Object.hasOwnProperty.call(BOOLEANS, arg)) return null;
  return BOOLEANS[arg];
}

/** Сгенерировать имя файла, если он недоступен **/

function constructFilename(msg) {
  return "upload." + mime.extension(msg.file.mime);
}

/** АГЕНТ **/

function createAgent() {
  var proxy = process.env["https_proxy"] || process.env["all_proxy"];
  if (!proxy) return;

  try {
    proxy = url.parse(proxy);
  } catch (e) {
    console.error("Error parsing proxy URL:", e, "Ignoring proxy.");
    return;
  }

  if ([ "socks:", "socks4:", "socks4a:", "socks5:", "socks5h:" ].indexOf(proxy.protocol) !== -1) {
    try {
      var SocksProxyAgent = require('socks-proxy-agent');
    } catch (e) {
      console.error("Error loading SOCKS proxy support, verify socks-proxy-agent is correctly installed. Ignoring proxy.");
      return;
    }
    return new SocksProxyAgent(proxy);
  }
  if ([ "http:", "https:" ].indexOf(proxy.protocol) !== -1) {
    try {
      var HttpsProxyAgent = require('https-proxy-agent');
    } catch (e) {
      console.error("Error loading HTTPS proxy support, verify https-proxy-agent is correctly installed. Ignoring proxy.");
      return;
    }
    return new HttpsProxyAgent(proxy);
  }

  console.error("Unknown proxy protocol:", util.inspect(proxy.protocol), "Ignoring proxy.");
}



exports.Timer = Timer;
exports.EditedMessage = EditedMessage;
exports.getSanitizedEnv = getSanitizedEnv;
exports.formatSignal = formatSignal;
exports.shells = shells;
exports.resolveShell = resolveShell;
exports.generateToken = generateToken;
exports.resolveBoolean = resolveBoolean;
exports.constructFilename = constructFilename;
exports.createAgent = createAgent;
