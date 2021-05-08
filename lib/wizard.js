var readline = require("readline");
var botgram = require("botgram");
var fs = require("fs");
var util = require("util");
var utils = require("./utils");

// Функции мастера

function stepAuthToken(rl, config) {
    return question(rl, "Сначала введите свой токен API бота: ")
    .then(function (token) {
        token = token.trim();
        //если (!/^\d{5,}:[a-zA-Z0-9_+/-]{20,}$/.test(token))
        //    выбросить новую ошибку();
        config.authToken = token;
        return createBot(token);
    }).catch(function (err) {
        console.error("Введен недействительный токен, попробуйте еще раз.\n%s\n", err);
        return stepAuthToken(rl, config);
    });
}

function stepOwner(rl, config, getNextMessage) {
    console.log("Жду сообщения...");
    return getNextMessage().then(function (msg) {
        var prompt = util.format("Должен %s «%s» (%s) быть владельцем бота? [y/n]: ", msg.chat.type, msg.chat.name, msg.chat.id);
        return question(rl, prompt)
        .then(function (answer) {
            console.log();
            answer = answer.trim().toLowerCase();
            if (answer === "y" || answer === "yes")
                config.owner = msg.chat.id;
            else
                return stepOwner(rl, config, getNextMessage);
        });
    });
}

function configWizard(options) {
    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    var config = {};
    var bot = null;

    return Promise.resolve()
    .then(function () {
        return stepAuthToken(rl, config);
    })
    .then(function (bot_) {
        bot = bot_;
        console.log("\nА теперь поговорите со мной, чтобы я узнал о вашем пользователе Telegram:\n%s\n", bot.link());
    })
    .then(function () {
        var getNextMessage = getPromiseFactory(bot);
        return stepOwner(rl, config, getNextMessage);
    })
    .then(function () {
        console.log("Все готово, пишем конфигурацию...");
        var contents = JSON.stringify(config, null, 4) + "\n";
        return writeFile(options.configFile, contents);
    })

    .catch(function (err) {
        console.error("Ошибка, мастер разбился:\n%s", err.stack);
        process.exit(1);
    })
    .then(function () {
        rl.close();
        if (bot) bot.stop();
        process.exit(0);
    });
}

//Обещаем коммунальные услуги

function question(interface, query) {
    return new Promise(function (resolve, reject) {
        interface.question(query, resolve);
    });
}

function writeFile(file, contents) {
    return new Promise(function (resolve, reject) {
        fs.writeFile(file, contents, "utf-8", function (err) {
            if (err) reject(err);
            else resolve();
        });
    });
}

function createBot(token) {
    return new Promise(function (resolve, reject) {
        var bot = botgram(token, { agent: utils.createAgent() });
        bot.on("error", function (err) {
            bot.stop();
            reject(err);
        });
        bot.on("ready", resolve.bind(this, bot));
    });
}

function getPromiseFactory(bot) {
    var resolveCbs = [];
    bot.message(function (msg, reply, next) {
        if (!msg.queued) {
            resolveCbs.forEach(function (resolve) {
                resolve(msg);
            });
            resolveCbs = [];
        }
        next();
    });
    return function () {
        return new Promise(function (resolve, reject) {
            resolveCbs.push(resolve);
        });
    };
}



exports.configWizard = configWizard;
