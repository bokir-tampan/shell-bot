/**
* Реализует эмулятор терминала. Мы используем terminal.js для
 * грязная работа по разбору escape-последовательностей, но реализовать наши
 * собственный TermState, с некоторыми особенностями по сравнению со стандартным
 * эмулятор терминала:
 *
 * - Линии и символы создаются по запросу. Терминал
 * начинается без содержания. Причина в том, что ты не хочешь
 * пустые строки, которые будут немедленно отправлены в ваш чат Telegram
 * после запуска команды.
 *
 * - Допускаются строки, длина которых превышает размер столбца. Дополнительный
 * символы добавляются, но курсор остается справа от края.
 * Telegram уже переносит длинные строки, помещая их в
 * терминал был бы уродливым.
 *
 * - Графические атрибуты пока не реализованы (не будут использоваться
 * в любом случае для Telegram).
 *
 * - На данный момент нет альтернативного буфера (мало что
 * смысл для рендеринга Telegram ...) FIXME
 *
 * Эмулятор терминала генерирует события, когда строки вставляются, изменяются,
 * удалены или исчезнут из поля зрения, аналогично исходному TermState.
 **/

var util = require("util");
var Terminal = require("terminal.js");

// FIXME: исследуйте исправленную палитру для лучшей поддержки на Android
var GRAPHICS = {
        '`': '\u25C6',
        'a': '\u2592',
        'b': '\u2409',
        'c': '\u240C',
        'd': '\u240D',
        'e': '\u240A',
        'f': '\u00B0',
        'g': '\u00B1',
        'h': '\u2424',
        'i': '\u240B',
        'j': '\u2518',
        'k': '\u2510',
        'l': '\u250C',
        'm': '\u2514',
        'n': '\u253C',
        'o': '\u23BA',
        'p': '\u23BB',
        'q': '\u2500',
        'r': '\u23BC',
        's': '\u23BD',
        't': '\u251C',
        'u': '\u2524',
        'v': '\u2534',
        'w': '\u252C',
        'x': '\u2502',
        'y': '\u2264',
        'z': '\u2265',
        '{': '\u03C0',
        '|': '\u2260',
        '}': '\u00A3',
        '~': '\u00B7'
};


/ ** ИНИЦИАЛИЗАЦИЯ И АКСЕССУАРЫ ** /

function TermState(options) {
  if (!options) options = {};
  this.rows = options.rows || 24;
  this.columns = options.columns || 80;

  this.defaultAttributes = {
    fg: null,
    bg: null,
    bold: false,
    underline: false,
    italic: false,
    blink: false,
    inverse: false,
  };
  this.reset();
}
util.inherits(TermState, require("events").EventEmitter);

TermState.prototype.reset = function reset() {
  this.lines = [];
  this.cursor = [0,0];
  this.savedCursor = [0,0];

  this.modes = {
    cursor: true,
    cursorBlink: false,
    appKeypad: false,
    wrap: true,
    insert: false,
    crlf: false,
    mousebtn: false,
    mousemtn: false,
    reverse: false,
    graphic: false,
    mousesgr: false,
  };
  this.attributes = Object.create(this.defaultAttributes);
  this._charsets = {
    "G0": "unicode",
    "G1": "unicode",
    "G2": "unicode",
    "G3": "unicode",
  };
  this._mappedCharset = "G0";
  this._mappedCharsetNext = "G0";
  this.metas = {
    title: '',
    icon: ''
  };
  this.leds = {};
  this._tabs = [];
  this.emit("reset");
};

function getGenericSetter(field) {
  return function genericSetter(name, value) {
    this[field + "s"][name] = value;
    this.emit(field, name);
  };
}

TermState.prototype.setMode = getGenericSetter("mode");
TermState.prototype.setMeta = getGenericSetter("meta");
TermState.prototype.setAttribute = getGenericSetter("attribute");
TermState.prototype.setLed = getGenericSetter("led");

TermState.prototype.getMode = function getMode(mode) {
  return this.modes[mode];
};

TermState.prototype.getLed = function getLed(led) {
  return !!this.leds[led];
};

TermState.prototype.ledOn = function ledOn(led) {
  this.setLed(led, true);
  return this;
};

TermState.prototype.resetLeds = function resetLeds() {
  this.leds = {};
  return this;
};

TermState.prototype.resetAttribute = function resetAttribute(name) {
  this.attributes[name] = this.defaultAttributes[name];
  return this;
};

TermState.prototype.mapCharset = function(target, nextOnly) {
  this._mappedCharset = target;
  if (!nextOnly) this._mappedCharsetNext = target;
  this.modes.graphic = this._charsets[this._mappedCharset] === "graphics"; // обратная совместимость
};

TermState.prototype.selectCharset = function(charset, target) {
  if (!target) target = this._mappedCharset;
  this._charsets[target] = charset;
  this.modes.graphic = this._charsets[this._mappedCharset] === "graphics"; // обратная совместимость
};


/ ** ОСНОВНЫЕ МЕТОДЫ ** /

/ * Перемещаем курсор * /
TermState.prototype.setCursor = function setCursor(x, y) {
  if (typeof x === 'number')
    this.cursor[0] = x;

  if (typeof y === 'number')
    this.cursor[1] = y;

  this.cursor = this.getCursor();
  this.emit("cursor");
  return this;
};

/ * Получить реальную позицию курсора (логическая может быть за пределами поля) * /
TermState.prototype.getCursor = function getCursor() {
  var x = this.cursor[0], y = this.cursor[1];

  if (x >= this.columns) x = this.columns - 1;
  else if (x < 0) x = 0;

  if (y >= this.rows) y = this.rows - 1;
  else if (y < 0) y = 0;

  return [x,y];
};

/ * Получить строку в указанной позиции, при необходимости выделяя ее * /
TermState.prototype.getLine = function getLine(y) {
  if (typeof y !== "number") y = this.getCursor()[1];
  if (y < 0) throw new Error("Invalid position to write to");

// Вставляем строки, пока строка в этой позиции не станет доступной
  while (!(y < this.lines.length))
    this.lines.push({ str: "", attr: null });

  return this.lines[y];
};

/ * Заменить строку в указанной позиции, при необходимости выделив ее * /
TermState.prototype.setLine = function setLine(y, line) {
  if (typeof y !== "number") line = y, y = this.getCursor()[1];
  this.getLine(y);
  this.lines[y] = line;
  return this;
};

/ * Записываем кусок текста (предполагается однострочный), начиная с позиции * /
TermState.prototype._writeChunk = function _writeChunk(position, chunk, insert) {
  var x = position[0], line = this.getLine(position[1]);
  if (x < 0) throw new Error("Invalid position to write to");

 // Вставляем пробелы, пока нужный столбец не станет доступным
  while (line.str.length < x)
    line.str += " ";
// Записываем кусок в позицию
  line.str = line.str.substring(0, x) + chunk + line.str.substring(x + (insert ? 0 : chunk.length));
  // ЗАДАЧА: добавить атрибут

  this.emit("lineChanged", position[1]);
  return this;
};

/ * Удаляем символы, начинающиеся с позиции * /
TermState.prototype.removeChar = function removeChar(n) {
  var x = this.cursor[0], line = this.getLine();
  if (x < 0) throw new Error("Invalid position to delete from");

// Вставляем пробелы, пока нужный столбец не станет доступным
  while (line.str.length < x)
    line.str += " ";

// Удаляем символы
  line.str = line.str.substring(0, x) + line.str.substring(x + n);

  this.emit("lineChanged", this.cursor[1]);
  return this;
};

TermState.prototype.eraseInLine = function eraseInLine(n) {
  var x = this.cursor[0], line = this.getLine();
  switch (n || 0) {
    case "after":
    case 0:
      line.str = line.str.substring(0, x);
      break;

    case "before":
    case 1:
      var str = "";
      while (str.length < x) str += " ";
      line.str = str + line.str.substring(x);
      break;

    case "all":
    case 2:
      line.str = "";
      break;
  }
  this.emit("lineChanged", this.cursor[1]);
  return this;
};

TermState.prototype.eraseInDisplay = function eraseInDisplay(n) {
  switch (n || 0) {
    case "below":
    case "after":
    case 0:
      this.eraseInLine(n);
      this.removeLine(this.lines.length - (this.cursor[1]+1), this.cursor[1]+1);
      break;

    case "above":
    case "before":
    case 1:
      for (var y = 0; y < this.cursor[1]; y++) {
        this.lines[y].str = "";
        this.emit("lineChanged", y);
      }
      this.eraseInLine(n);
      break;

    case "all":
    case 2:
      this.removeLine(this.lines.length, 0);
      break;
  }
  return this;
};

TermState.prototype.removeLine = function removeLine(n, y) {
  if (typeof y !== "number") y = this.cursor[1];
  if (n <= 0) return this;

  if (y + n > this.lines.length)
    n = this.lines.length - y;
  if (n <= 0) return this;

  this.emit("linesRemoving", y, n);
  this.lines.splice(y, n);
  return this;
};

TermState.prototype.insertLine = function insertLine(n, y) {
  if (typeof y !== "number") y = this.cursor[1];
  if (n <= 0) return this;

  if (y + n > this.rows)
    n = this.rows - y;
  if (n <= 0) return this;

  this.getLine(y);
  this.removeLine((this.lines.length + n) - this.rows, this.rows - n);
  for (var i = 0; i < n; i++)
    this.lines.splice(y, 0, { str: "", attr: null });
  this.emit("linesInserted", y, n);
  return this;
};

TermState.prototype.scroll = function scroll(n) {
  if (n > 0) { // вверх
    if (n > this.lines.length) n = this.lines.length; //FIXME: это нормально?
    if (n > 0) this.emit("linesScrolling", n);
    this.lines = this.lines.slice(n);
  } else if (n < 0) { // downвниз
    n = -n;
    if (n > this.rows) n = this.rows; //FIXME: это нормально?
    var extraLines = (this.lines.length + n) - this.rows;
    if (extraLines > 0) this.emit("linesScrolling", -extraLines);
    this.lines = this.lines.slice(0, this.rows - n);
    this.insertLine(n, 0);
  }
  return this;
};

/** ВЫСОКИЙ УРОВЕНЬ **/
TermState.prototype._graphConvert = function(content) {
       // оптимизация в 99% случаев
        if(this._mappedCharset === this._mappedCharsetNext && !this.modes.graphic) {
                return content;
        }

        var result = "", i;
        for(i = 0; i < content.length; i++) {
                result += (this.modes.graphic && content[i] in GRAPHICS) ?
                        GRAPHICS[content[i]] :
                        content[i];
                this._mappedCharset = this._mappedCharsetNext;
                this.modes.graphic = this._charsets[this._mappedCharset] === "graphics"; // backwards compatibility
        }
        return result;
};

TermState.prototype.write = function write(chunk) {
  chunk.split("\n").forEach(function (line, i) {
    if (i > 0) {
      // Начать новую строку
      if (this.cursor[1] + 1 >= this.rows)
        this.scroll(1);
      this.mvCursor(0, 1);
      this.getLine();
    }

    if (!line.length) return;
    if (this.getMode("graphic")) this.getLine().code = true;
    line = this._graphConvert(line);
    this._writeChunk(this.cursor, line, this.getMode("insert"));
    this.cursor[0] += line.length;
  }.bind(this));
  this.emit("cursor");
  return this;
};

TermState.prototype.resize = function resize(size) {
  if (this.lines.length > size.rows)
    this.scroll(this.lines.length - size.rows);
  this.rows = size.rows;
  this.columns = size.columns;
  this.setCursor();
  this.emit("resize", size);
  return this;
};

TermState.prototype.mvCursor = function mvCursor(x, y) {
  var cursor = this.getCursor();
  return this.setCursor(cursor[0] + x, cursor[1] + y);
};

TermState.prototype.toString = function toString() {
  return this.lines.map(function (line) { return line.str; }).join("\n");
};

TermState.prototype.prevLine = function prevLine() {
  if (this.cursor[1] > 0) this.mvCursor(0, -1);
  else this.scroll(-1);
  return this;
};

TermState.prototype.nextLine = function nextLine() {
  if (this.cursor[1] < this.rows - 1) this.mvCursor(0, +1);
  else this.scroll(+1);
  return this;
};

TermState.prototype.saveCursor = function saveCursor() {
  this.savedCursor = this.getCursor();
  return this;
};

TermState.prototype.restoreCursor = function restoreCursor() {
  this.cursor = this.savedCursor;
  return this.setCursor();
};

TermState.prototype.insertBlank = function insertBlank(n) {
  var str = "";
  while (str.length < n) str += " ";
  return this._writeChunk(this.cursor, str, true);
};

TermState.prototype.eraseCharacters = function eraseCharacters(n) {
  var str = "";
  while (str.length < n) str += " ";
  return this._writeChunk(this.cursor, str, false);
};

TermState.prototype.setScrollRegion = function setScrollRegion(n, m) {
  //TODO
  return this;
};

TermState.prototype.switchBuffer = function switchBuffer(alt) {
  if (this.alt !== alt) {
    this.scroll(this.lines.length);
    this.alt = alt;
  }
  return this;
};

TermState.prototype.getBufferRowCount = function getBufferRowCount() {
  return this.lines.length;
};


/ **
* перемещает курсор вперед или назад на указанное количество вкладок
* @param n {число} - количество вкладок, которые нужно переместить. <0 перемещается назад,> 0 перемещается
* вперед
* /
TermState.prototype.mvTab = function(n) {
	var x = this.getCursor()[0];
	var tabMax = this._tabs[this._tabs.length - 1] || 0;
	var positive = n > 0;
	n = Math.abs(n);
	while(n !== 0 && x > 0 && x < this.columns-1) {
		x += positive ? 1 : -1;
		if(this._tabs.indexOf(x) != -1 || (x > tabMax && x % 8 === 0))
			n--;
	}
	this.setCursor(x);
};

/**
* установить вкладку в указанной позиции
* @param pos {number} - позиция для установки вкладки
*/
TermState.prototype.setTab = function(pos) {
// Устанавливаем текущий курсор по умолчанию, если позиция табуляции не указана
	if(pos === undefined) {
		pos = this.getCursor()[0];
	}
	// Добавляем позицию табуляции, только если ее еще нет
	if (this._tabs.indexOf(pos) != -1) {
		this._tabs.push(pos);
		this._tabs.sort();
	}
};

/**
* удалить вкладку
* @param pos {число} - позиция для удаления табуляции. Ничего не делать, если вкладка не
* установить в этой позиции
*/
TermState.prototype.removeTab = function(pos) {
	var i, tabs = this._tabs;
	for(i = 0; i < tabs.length && tabs[i] !== pos; i++);
	tabs.splice(i, 1);
};

/**
* удаляет вкладку по заданному индексу
* @params n {number} - может быть одним из следующих
* <ul>
* <li> "current" или 0: поиск вкладки в текущей позиции. вкладки в данный момент нет
* позиция удалить следующую вкладку </li>
* <li> «все» или 3: удаляет все вкладки. </li>
*/
TermState.prototype.tabClear = function(n) {
	switch(n || "current") {
		case "current":
		case 0:
			for(var i = this._tabs.length - 1; i >= 0; i--) {
				if(this._tabs[i] < this.getCursor()[0]) {
					this._tabs.splice(i, 1);
					break;
				}
			}
			break;
		case "all":
		case 3:
			this._tabs = [];
			break;
	}
};



function createTerminal(options) {
  var state = new TermState(options);
  var term = new Terminal({});
  term.state = state;
  return term;
}

exports.TermState = TermState;
exports.createTerminal = createTerminal;
