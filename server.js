#!/usr/bin/env node
// Запускает бота, обрабатывает разрешения и контекст чата,
// интерпретирует команды и делегирует фактическую команду
// запускаемся к экземпляру Command. При запуске владелец
// Должен быть указан идентификатор.

var path = require("path");
var fs = require("fs");
var botgram = require("botgram");
var escapeHtml = require("escape-html");
var utils = require("./lib/utils");
var Command = require("./lib/command").Command;
var Editor = require("./lib/editor").Editor;

var CONFIG_FILE = path.join(__dirname, "config.json");
try {
    var config = require(CONFIG_FILE);
} catch (e) {
    console.error("Не удалось загрузить файл конфигурации при запуске мастера.\n");
    require("./lib/wizard").configWizard({ configFile: CONFIG_FILE });
    return;
}

var bot = botgram(config.authToken, { agent: utils.createAgent() });
var owner = config.owner;
var tokens = {};
var granted = {};
var contexts = {};
var defaultCwd = process.env.HOME || process.cwd();

var fileUploads = {};

bot.on("updateError", function (err) {
  console.error("Ошибка при обновлении:", err);
});

bot.on("synced", function () {
  console.log("Бот готов.");
});


function rootHook(msg, reply, next) {
  if (msg.queued) return;

  var id = msg.chat.id;
  var allowed = id === owner || granted[id];

// Если это сообщение содержит токен, проверяем его
  if (!allowed && msg.command === "start" && Object.hasOwnProperty.call(tokens, msg.args())) {
    var token = tokens[msg.args()];
    delete tokens[msg.args()];
    granted[id] = true;
    allowed = true;

// Уведомляем владельца
    // FIXME: ответ на сообщение токена
    var contents = (msg.user ? "User" : "Chat") + " <em>" + escapeHtml(msg.chat.name) + "</em>";
    if (msg.chat.username) contents += " (@" + escapeHtml(msg.chat.username) + ")";
    contents += "теперь можно использовать бот. Чтобы отозвать, используйте:";
    reply.to(owner).html(contents).command("revoke", id);
  }

 // Если чат не разрешен, а пользователь разрешен, используем его контекст
  if (!allowed && (msg.from.id === owner || granted[msg.from.id])) {
    id = msg.from.id;
    allowed = true;
  }

// Проверяем, разрешен ли чат
  if (!allowed) {
    if (msg.command === "start") reply.html("Нет прав на использование этого бота.");
    return;
  }

  if (!contexts[id]) contexts[id] = {
    id: id,
    shell: utils.shells[0],
    env: utils.getSanitizedEnv(),
    cwd: defaultCwd,
    size: {columns: 40, rows: 20},
    silent: true,
    interactive: false,
    linkPreviews: false,
  };

  msg.context = contexts[id];
  next();
}
bot.all(rootHook);
bot.edited.all(rootHook);


// Ответы
bot.message(function (msg, reply, next) {
  if (msg.reply === undefined || msg.reply.from.id !== this.get("id")) return next();
  if (msg.file)
    return handleDownload(msg, reply);
  if (msg.context.editor)
    return msg.context.editor.handleReply(msg);
  if (!msg.context.command)
    return reply.html("Ни одна команда не запущена.");
  msg.context.command.handleReply(msg);
});

// Редактирует
bot.edited.message(function (msg, reply, next) {
  if (msg.context.editor)
    return msg.context.editor.handleEdit(msg);
  next();
});

// Удобная команда - ведет себя как /run или /enter
// в зависимости от того, запущена ли уже команда
bot.command("r", function (msg, reply, next) {
// Немного хакерский, но он показывает силу
  // Система противодействия Botgram!
  msg.command = msg.context.command ? "enter" : "run";
  next();
});

// Отправка сигнала
bot.command("cancel", "kill", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (!msg.context.command)
    return reply.html("Ни одна команда не запущена.");

  var group = msg.command === "cancel";
  var signal = group ? "SIGINT" : "SIGTERM";
  if (arg) signal = arg.trim().toUpperCase();
  if (signal.substring(0,3) !== "SIG") signal = "SIG" + signal;
  try {
    msg.context.command.sendSignal(signal, group);
  } catch (err) {
    reply.reply(msg).html("Не удалось отправить сигнал.");
  }
});

// Отправка ввода
bot.command("enter", "type", function (msg, reply, next) {
  var args = msg.args();
  if (!msg.context.command)
    return reply.html("Ни одна команда не запущена.");
  if (msg.command === "type" && !args) args = " ";
  msg.context.command.sendInput(args, msg.command === "type");
});
bot.command("control", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (!msg.context.command)
    return reply.html("Ни одна команда не запущена.");
  if (!arg || !/^[a-zA-Z]$/i.test(arg))
    return reply.html("Используйте /control &lt;letter&gt; отправить Control + письмо процессу.");
  var code = arg.toUpperCase().charCodeAt(0) - 0x40;
  msg.context.command.sendInput(String.fromCharCode(code), true);
});
bot.command("meta", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (!msg.context.command)
    return reply.html("Ни одна команда не запущена.");
  if (!arg)
    return msg.context.command.toggleMeta();
  msg.context.command.toggleMeta(true);
  msg.context.command.sendInput(arg, true);
});
bot.command("end", function (msg, reply, next) {
  if (!msg.context.command)
    return reply.html("Ни одна команда не запущена.");
  msg.context.command.sendEof();
});

// Перезапись
bot.command("redraw", function (msg, reply, next) {
  if (!msg.context.command)
    return reply.html("Ни одна команда не запущена.");
  msg.context.command.redraw();
});

// Запуск команды
bot.command("run", function (msg, reply, next) {
  var args = msg.args();
  if (!args)
    return reply.html("Используйте /run &lt;command&gt; выполнить что-то.");

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("Команда уже выполняется.");
  }

  if (msg.editor) msg.editor.detach();
  msg.editor = null;

  console.log("Чат «%s»: запущенная команда «%s»", msg.chat.name, args);
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function() {
    msg.context.command = null;
  });
});

// Запуск редактора
bot.command("file", function (msg, reply, next) {
  var args = msg.args();
  if (!args)
    return reply.html("Используйте /file &lt;file&gt; для просмотра или редактирования текстового файла.");

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.reply(command.initialMessage.id || msg).text("Команда запущена.");
  }

  if (msg.editor) msg.editor.detach();
  msg.editor = null;

  try {
    var file = path.resolve(msg.context.cwd, args);
    msg.context.editor = new Editor(reply, file);
  } catch (e) {
    reply.html("Не удалось открыть файл: %s", e.message);
  }
});

// Клавиатура
bot.command("keypad", function (msg, reply, next) {
  if (!msg.context.command)
    return reply.html("Ни одна команда не запущена.");
  try {
    msg.context.command.toggleKeypad();
  } catch (e) {
    reply.html("Не удалось переключить клавиатуру.");
  }
});

// Загрузка / скачивание файла
bot.command("upload", function (msg, reply, next) {
  var args = msg.args();
  if (!args)
    return reply.html("Используйте /upload &lt;file&gt; и я пришлю это тебе");

  var file = path.resolve(msg.context.cwd, args);
  try {
    var stream = fs.createReadStream(file);
  } catch (e) {
    return reply.html("Не удалось открыть файл: %s", e.message);
  }

// ловить ошибки, но ничего не делать, они будут переданы обработчику ниже
  stream.on("error", function (e) {});

  reply.action("upload_document").document(stream).then(function (e, msg) {
    if (e)
      return reply.html("Не удалось отправить файл: %s", e.message);
    fileUploads[msg.id] = file;
  });
});
function handleDownload(msg, reply) {
  if (Object.hasOwnProperty.call(fileUploads, msg.reply.id))
    var file = fileUploads[msg.reply.id];
  else if (msg.context.lastDirMessageId == msg.reply.id)
    var file = path.join(msg.context.cwd, msg.filename || utils.constructFilename(msg));
  else
    return;

  try {
    var stream = fs.createWriteStream(file);
  } catch (e) {
    return reply.html("Не удалось записать файл: %s", e.message);
  }
  bot.fileStream(msg.file, function (err, ostream) {
    if (err) throw err;
    reply.action("typing");
    ostream.pipe(stream);
    ostream.on("end", function () {
      reply.html("Файл записан: %s", file);
    });
  });
}

// Статус
bot.command("status", function (msg, reply, next) {
  var content = "", context = msg.context;

// Запуск команды
  if (context.editor) content += "Editing file: " + escapeHtml(context.editor.file) + "\n\n";
  else if (!context.command) content += "Команды не выполняются.\n\n";
  else content += "Команда выполняется, PID "+context.command.pty.pid+".\n\n";
// Настройки чата
  content += "Shell: " + escapeHtml(context.shell) + "\n";
  content += "Size: " + context.size.columns + "x" + context.size.rows + "\n";
  content += "Directory: " + escapeHtml(context.cwd) + "\n";
  content += "Silent: " + (context.silent ? "yes" : "no") + "\n";
  content += "Shell interactive: " + (context.interactive ? "yes" : "no") + "\n";
  content += "Link previews: " + (context.linkPreviews ? "yes" : "no") + "\n";
  var uid = process.getuid(), gid = process.getgid();
  if (uid !== gid) uid = uid + "/" + gid;
  content += "UID/GID: " + uid + "\n";

// Разрешенные чаты (msg.chat.id преднамеренно)
  if (msg.chat.id === owner) {
    var grantedIds = Object.keys(granted);
    if (grantedIds.length) {
      content += "\nРазрешенные чаты:\n";
      content += grantedIds.map(function (id) { return id.toString(); }).join("\n");
    } else {
      content += "\nНет чатов. Используйте /grant или /token, чтобы разрешить другому чату использовать бота.";
    }
  }

  if (context.command) reply.reply(context.command.initialMessage.id);
  reply.html(content);
});

// Настройки: Shell
bot.command("shell", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (arg) {
    if (msg.context.command) {
      var command = msg.context.command;
      return reply.reply(command.initialMessage.id || msg).html("Невозможно изменить оболочку во время выполнения команды.");
    }
    try {
      var shell = utils.resolveShell(arg);
      msg.context.shell = shell;
      reply.html("Оболочка изменена.");
    } catch (err) {
      reply.html("Не удалось изменить оболочку.");
    }
  } else {
    var shell = msg.context.shell;
    var otherShells = utils.shells.slice(0);
    var idx = otherShells.indexOf(shell);
    if (idx !== -1) otherShells.splice(idx, 1);

    var content = "Current shell: " + escapeHtml(shell);
    if (otherShells.length)
      content += "\n\nOther shells:\n" + otherShells.map(escapeHtml).join("\n");
    reply.html(content);
  }
});

// Настройки: Рабочий каталог
bot.command("cd", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (arg) {
    if (msg.context.command) {
      var command = msg.context.command;
      return reply.reply(command.initialMessage.id || msg).html("Невозможно сменить каталог во время выполнения команды.");
    }
    var newdir = path.resolve(msg.context.cwd, arg);
    try {
      fs.readdirSync(newdir);
      msg.context.cwd = newdir;
    } catch (err) {
      return reply.html("%s", err);
    }
  }

  reply.html("Сейчас на: %s", msg.context.cwd).then().then(function (m) {
    msg.context.lastDirMessageId = m.id;
  });
});

// Настройки: Среды
bot.command("env", function (msg, reply, next) {
  var env = msg.context.env, key = msg.args();
  if (!key)
    return reply.reply(msg).html("Используйте %s, чтобы увидеть значение переменной, или %s, чтобы изменить его.", "/env <name>", "/env <name>=<value>");

  var idx = key.indexOf("=");
  if (idx === -1) idx = key.indexOf(" ");

  if (idx !== -1) {
    if (msg.context.command) {
      var command = msg.context.command;
      return reply.reply(command.initialMessage.id || msg).html("Невозможно изменить среду во время выполнения команды.");
    }

    var value = key.substring(idx + 1);
    key = key.substring(0, idx).trim().replace(/\s+/g, " ");
    if (value.length) env[key] = value;
    else delete env[key];
  }

  reply.reply(msg).text(printKey(key));

  function printKey(k) {
    if (Object.hasOwnProperty.call(env, k))
      return k + "=" + JSON.stringify(env[k]);
    return k + " unset";
  }
});

// Настройки: Размер
bot.command("resize", function (msg, reply, next) {
  var arg = msg.args(1)[0] || "";
  var match = /(\d+)\s*((\sby\s)|x|\s|,|;)\s*(\d+)/i.exec(arg.trim());
  if (match) var columns = parseInt(match[1]), rows = parseInt(match[4]);
  if (!columns || !rows)
    return reply.text("Используйте /resize <columns> <rows>, чтобы изменить размер терминала.");

  msg.context.size = { columns: columns, rows: rows };
  if (msg.context.command) msg.context.command.resize(msg.context.size);
  reply.reply(msg).html("Размер терминала изменен.");
});

// Settings: Silent
bot.command("setsilent", function (msg, reply, next) {
  var arg = utils.resolveBoolean(msg.args());
  if (arg === null)
    return reply.html("Используйте /setsilent [yes|no], чтобы указать, будет ли новый вывод команды отправляться без вывода сообщений..");

  msg.context.silent = arg;
  if (msg.context.command) msg.context.command.setSilent(arg);
  reply.html("Выход будет " + (arg ? "" : "нет ") + "быть отправленным молча.");
});

// Настройки: интерактивные
bot.command("setinteractive", function (msg, reply, next) {
  var arg = utils.resolveBoolean(msg.args());
  if (arg === null)
    return reply.html("Используйте /setinteractive [yes|no], чтобы указать, является ли оболочка интерактивной. Включение этого параметра приведет к тому, что ваши псевдонимы в, например, .bashrc будут соблюдаться, но может вызвать ошибки в некоторых оболочках, таких как fish..");

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.reply(command.initialMessage.id || msg).html("Невозможно изменить интерактивный флаг во время выполнения команды.");
  }
  msg.context.interactive = arg;
  reply.html("Команды будут " + (arg ? "" : "нет ") + "запускаться с интерактивными оболочками.");
});

// Настройки: превью ссылок
bot.command("setlinkpreviews", function (msg, reply, next) {
  var arg = utils.resolveBoolean(msg.args());
  if (arg === null)
    return reply.html("Используйте /setlinkpreviews [yes|no], чтобы управлять расширением ссылок в выводе..");

  msg.context.linkPreviews = arg;
  if (msg.context.command) msg.context.command.setLinkPreviews(arg);
  reply.html("Ссылки в выводе будут " + (arg ? "" : "нет ") + "быть расширенным.");
});

// Настройки: Другой доступ к чату
bot.command("grant", "revoke", function (msg, reply, next) {
  if (msg.context.id !== owner) return;
  var arg = msg.args(1)[0], id = parseInt(arg);
  if (!arg || isNaN(id))
    return reply.html("Используйте %s или %s, чтобы указать, может ли чат с этим идентификатором использовать этого бота..", "/grant <id>", "/revoke <id>");
  reply.reply(msg);
  if (msg.command === "grant") {
    granted[id] = true;
    reply.html("Чат %s теперь может использовать этого бота. Используйте /revoke, чтобы отменить.", id);
  } else {
    if (contexts[id] && contexts[id].command)
      return reply.html("Не удалось отозвать указанный чат, потому что команда выполняется.");
    delete granted[id];
    delete contexts[id];
    reply.html("Чат %s успешно удален.", id);
  }
});
bot.command("token", function (msg, reply, next) {
  if (msg.context.id !== owner) return;
  var token = utils.generateToken();
  tokens[token] = true;
  reply.disablePreview().html("Создан одноразовый токен доступа. Для получения доступа к боту можно использовать следующую ссылку:\n%s\n :", bot.link(token));
  reply.command(true, "start", token);
});

// Приветственное сообщение, помощь
bot.command("start", function (msg, reply, next) {
  if (msg.args() && msg.context.id === owner && Object.hasOwnProperty.call(tokens, msg.args())) {
    reply.html("Вы уже прошли аутентификацию; токен был отозван.");
  } else {
    reply.html("Добро пожаловать! Используйте /run для выполнения команд и отвечайте на мои сообщения для отправки ввода. /help для получения дополнительной информации.");
  }
});

bot.command("help", function (msg, reply, next) {
  reply.html(
    "Используйте /run & lt; command & gt; и я выполню это для вас. Пока он работает, вы можете:\n" +
    "\n" +
    "‣ Ответьте на одно из моих сообщений, чтобы отправить ввод в команду, или используйте /enter.\n" +
    "‣ Используйте /end для отправки EOF (Ctrl + D) команде.\n" +
    "‣ Используйте /cancel для отправки SIGINT (Ctrl + C) группе процессов или выбранного вами сигнала.\n" +
    "‣ Используйте /kill, чтобы отправить SIGTERM корневому процессу или выбранному вами сигналу.\n" + 
    "‣ Для графических приложений используйте /redraw, чтобы принудительно перерисовать экран..\n" +
    "‣ Используйте /type или /control для нажатия клавиш, /meta для отправки следующей клавиши с помощью Alt или /keypad для отображения клавиатуры для специальных клавиш.\n" + 
    "\n" +
    "Вы можете увидеть текущий статус и настройки этого чата с помощью /status. Используйте /env для" +
    "управлять средой, /cd, чтобы изменить текущий каталог, /shell, чтобы увидеть или " +
    "изменить оболочку, используемую для запуска команд, и /resize, чтобы изменить размер терминала.\n" +
    "\n" +
    "По умолчанию выходные сообщения отправляются без звука (без звука) и ссылки не раскрываются. " +
    "Это можно изменить с помощью /setsilent и /setlinkpreviews. Примечание: ссылки" +
    "никогда не раскрывается в строках статуса.\n" +
    "\n" +
    "<em>Additional features</em>\n" +
    "\n" +
    "Используйте /upload & lt; file & gt; и я пришлю вам этот файл. Если вы ответите на это " +
    "сообщение, загрузив мне файл, я заменю его вашим.\n" +
    "\n" +
    "Вы также можете использовать /file & lt; file & gt; для отображения содержимого файла в виде текста " +
    "сообщение. Это также позволяет вам редактировать файл, но вы должны знать, как это сделать..."
  );
});

// FIXME: добавить возможности встроенного бота!
// FIXME: possible feature: ограничить чаты UID
// FIXME: persistence
// FIXME: формировать сообщения, чтобы мы не выходили за пределы, и правильно реагировать на них


bot.command(function (msg, reply, next) {
  reply.reply(msg).text("Неверная команда.");
});
