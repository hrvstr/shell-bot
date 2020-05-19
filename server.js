#!/usr/bin/env node
// Starts the bot, handles permissions and chat context,
// interprets commands and delegates the actual command
// running to a Command instance. When started, an owner
// ID should be given.

var path = require("path");
var fs = require("fs");
var botgram = require("botgram");
var escapeHtml = require("escape-html");
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

var bot = botgram(config.authToken);
var owner = config.owner;
var tokens = {};
var granted = {};
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
  var allowed = id === owner || granted[id];

  // If this message contains a token, check it
  if (!allowed && msg.command === "start" && Object.hasOwnProperty.call(tokens, msg.args())) {
    var token = tokens[msg.args()];
    delete tokens[msg.args()];
    granted[id] = true;
    allowed = true;

    // Notify owner
    // FIXME: reply to token message
    var contents = (msg.user ? "User" : "Chat") + " <em>" + escapeHtml(msg.chat.name) + "</em>";
    if (msg.chat.username) contents += " (@" + escapeHtml(msg.chat.username) + ")";
    contents += " can now use the bot. To revoke, use:";
    reply.to(owner).html(contents).command("revoke", id);
  }

  // If chat is not allowed, but user is, use its context
  if (!allowed && (msg.from.id === owner || granted[msg.from.id])) {
    id = msg.from.id;
    allowed = true;
  }

  // Check that the chat is allowed
  if (!allowed) {
    if (msg.command === "start") reply.html("Not authorized to use this bot.");
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

// Signal sending
bot.command("cancel", "kill", function (msg, reply, next) {
  var arg = msg.args(1)[0];
  if (!msg.context.command)
    return reply.html("No command is running.");

  var group = msg.command === "cancel";
  var signal = group ? "SIGINT" : "SIGTERM";
  if (arg) signal = arg.trim().toUpperCase();
  if (signal.substring(0,3) !== "SIG") signal = "SIG" + signal;
  try {
    msg.context.command.sendSignal(signal, group);
  } catch (err) {
    reply.reply(msg).html("Couldn't send signal.");
  }
});

// Status
bot.command("status", function (msg, reply, next) {
  var content = "", context = msg.context;

  // Running command
  if (!context.command) content += "No command running.\n\n";
  else content += "Command running, PID "+context.command.pty.pid+".\n\n";

  // Chat settings
  content += "Silent: " + (context.silent ? "yes" : "no") + "\n";
  content += "Shell interactive: " + (context.interactive ? "yes" : "no") + "\n";
  var uid = process.getuid(), gid = process.getgid();
  if (uid !== gid) uid = uid + "/" + gid;
  content += "UID/GID: " + uid + "\n";

  if (context.command) reply.reply(context.command.initialMessage.id);
  reply.html(content);
});

// Settings: Silent
bot.command("setsilent", function (msg, reply, next) {
  var arg = utils.resolveBoolean(msg.args());
  if (arg === null)
    return reply.html("Use /setsilent [yes|no] to control whether new output from the command will be sent silently.");

  msg.context.silent = arg;
  if (msg.context.command) msg.context.command.setSilent(arg);
  reply.html("Output will " + (arg ? "" : "not ") + "be sent silently.");
});

// Settings: Interactive
	bot.command("setinteractive", function (msg, reply, next) {
	  var arg = utils.resolveBoolean(msg.args());
	  if (arg === null)
	    return reply.html("Use /setinteractive [yes|no] to control whether shell is interactive. Enabling it will cause your aliases in i.e. .bashrc to be honored, but can cause bugs in some shells such as fish.");
	
	  if (msg.context.command) {
	    var command = msg.context.command;
	    return reply.reply(command.initialMessage.id || msg).html("Can't change the interactive flag while a command is running.");
	  }
	  msg.context.interactive = arg;
	  reply.html("Commands will " + (arg ? "" : "not ") + "be started with interactive shells.");
	});

// Welcome message, help
bot.command("start", function (msg, reply, next) {
  if (msg.args() && msg.context.id === owner && Object.hasOwnProperty.call(tokens, msg.args())) {
    reply.html("You were already authenticated; the token has been revoked.");
  } else {
    reply.html(
      "👳 Salam aleikum habibi!");
  }
});

bot.command("help", function (msg, reply, next) {
  reply.html(
    "‣ Use /cancel to send SIGINT (Ctrl+C) to the process group, or the signal you choose.\n" +
    "‣ Use /kill to send SIGTERM to the root process, or the signal you choose.\n" + 
    "You can see the current status and settings for this chat with /status."
  );
});

// HRVSTR AREA

// Process
bot.command("process", function (msg, reply, next) {

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("A command is already running.");
  }

  if (msg.editor) msg.editor.detach();
  msg.editor = null;
  
  var args = "process";
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function() {
    msg.context.command = null;
  });
});

// Upload
bot.command("upload", function (msg, reply, next) {

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("A command is already running.");
  }

  if (msg.editor) msg.editor.detach();
  msg.editor = null;
  
  var args = "upload";
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function() {
    msg.context.command = null;
  });
});

// List files
bot.command("list", function (msg, reply, next) {

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("A command is already running.");
  }

  if (msg.editor) msg.editor.detach();
  msg.editor = null;
  
  var args = "list";
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function() {
    msg.context.command = null;
  });
});

// Clear incoming
bot.command("clear", function (msg, reply, next) {

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("A command is already running.");
  }

  if (msg.editor) msg.editor.detach();
  msg.editor = null;
  
  var args = "clear-incomming";
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function() {
    msg.context.command = null;
  });
});

// Fix permissions
bot.command("permissions", function (msg, reply, next) {

  if (msg.context.command) {
    var command = msg.context.command;
    return reply.text("A command is already running.");
  }

  if (msg.editor) msg.editor.detach();
  msg.editor = null;
  
  var args = "fix-permissions";
  msg.context.command = new Command(reply, msg.context, args);
  msg.context.command.on("exit", function() {
    msg.context.command = null;
  });
});

// INVALID CMD

bot.command(function (msg, reply, next) {
  reply.reply(msg).text("Invalid command.");
});
