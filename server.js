#!/usr/bin/env node
// Starts the bot, handles permissions and chat context,
// interprets commands and delegates the actual command
// running to a Command instance. When started, an owner
// ID should be given.

var path = require("path");
var botgram = require("botgram");
var utils = require("./lib/utils");
var Command = require("./lib/command").Command;

var CONFIG_FILE = path.join(__dirname, "config.json");
try {
  var config = require(CONFIG_FILE);
} catch (e) {
  console.error("Couldn't load the configuration file, starting the wizard.\n");
  require("./lib/wizard").configWizard({ configFile: CONFIG_FILE });
  return;
}

var bot = botgram(config.authToken, { agent: utils.createAgent() });
var owner = config.owner;
var contexts = {};
var defaultCwd = process.env.HOME || process.cwd();

bot.on("updateError", function (err) {
  console.error("Error when updating:", err);
});

bot.on("synced", function () {
  console.log("Bot ready.");
});

function rootHook(msg, reply, next) {
  if (msg.queued) return;

  var id = msg.chat.id;
  var allowed = id === owner;

  if (!contexts[id])
    contexts[id] = {
      id: id,
      shell: utils.shells[0],
      env: utils.getSanitizedEnv(),
      cwd: defaultCwd,
      size: { columns: 40, rows: 20 },
      silent: true,
      interactive: false,
      linkPreviews: false,
    };

  msg.context = contexts[id];
  next();
}

bot.all(rootHook);
bot.edited.all(rootHook);

bot.command("r", function (msg, reply, next) {
  msg.command = msg.context.command ? "enter" : "run";
  next();
});

// Signal sending
bot.command("cancel", "kill", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (!msg.context.command) return reply.html("No command is running.");

  var group = msg.command === "cancel";
  var signal = group ? "SIGINT" : "SIGTERM";
  if (arg) signal = arg.trim().toUpperCase();
  if (signal.substring(0, 3) !== "SIG") signal = "SIG" + signal;
  try {
    msg.context.command.sendSignal(signal, group);
  } catch (err) {
    reply.reply(msg).html("Couldn't send signal.");
  }
});

// Command start
bot.command("run", function (msg, reply, next) {
  var args = msg.args();
  if (!args)
    return reply.html("Use /run &lt;command&gt; to execute something.");

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("A command is already running.");
  }

  if (msg.editor) msg.editor.detach();
  msg.editor = null;

  console.log("Chat «%s»: running command «%s»", msg.chat.name, args);
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function () {
    msg.context.command = null;
  });
});

// Status
bot.command("status", function (msg, reply, next) {
  var content = "",
    context = msg.context;

  // Running command
  if (!context.command) content += "No command running.\n\n";
  else content += "Command running, PID " + context.command.pty.pid + ".\n\n";

  if (context.command) reply.reply(context.command.initialMessage.id);
  reply.html(content);
});

// Welcome message
bot.command("start", function (msg, reply, next) {
  reply.html("👋 Salam aleikum habibi");
});

// Get
bot.command("get", function (msg, reply, next) {
  var args = msg.args();
  if (!args)
    return reply.html("Use /irc &lt;BOT&gt; &lt;PACK&gt; to download files.");

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("A command is already running.");
  }

  var args = "weeget '" + msg.args() + "'";
  console.log("Chat «%s»: running WeeChat command «%s»", msg.chat.name, args);
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function () {
    msg.context.command = null;
  });
});

// URL
bot.command("url", function (msg, reply, next) {
  var args = msg.args();
  if (!args)
    return reply.html("Use /url &lt;URL&gt; &lt;PACK&gt; to convert a URL.");

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("A command is already running.");
  }

  var args = "/home/dietpi/.local/bin/yt-dlp --get-url '" + msg.args() + "'";
  console.log("Chat «%s»: running WeeChat command «%s»", msg.chat.name, args);
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function () {
    msg.context.command = null;
  });
});

// Process
bot.command("process", function (msg, reply, next) {
  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("A command is already running.");
  }

  var args = "process";
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function () {
    msg.context.command = null;
  });
});

// Upload
bot.command("upload", function (msg, reply, next) {
  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("A command is already running.");
  }

  var args = "upload";
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function () {
    msg.context.command = null;
  });
});

// List
bot.command("list", function (msg, reply, next) {
  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("A command is already running.");
  }

  var args = "list";
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function () {
    msg.context.command = null;
  });
});

// Help
bot.command(function (msg, reply, next) {
  reply.reply(msg).text("Invalid command.");
});
