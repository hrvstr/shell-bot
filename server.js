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

// Welcome message
bot.command("start", function (msg, reply) {
  reply.html("👋 Salam aleikum habibi");
});

// Commands
const commands = [
  { name: "process" },
  { name: "upload" },
  { name: "list" },
  { name: "new", binary: "/home/dietpi/commands/jellyget" },
  { name: "scan", binary: "/home/dietpi/commands/scan" },
  {
    name: "url",
    binary: "/home/dietpi/.local/bin/yt-dlp --get-url",
    arg: true,
    help: "Use /url &lt;URL&gt; to convert a URL.",
  },
  {
    name: "add",
    binary: "whitelist",
    arg: true,
    help: "Use /add &lt;TITLE&gt; to whitelist shows.",
  },
  {
    name: "get",
    binary: "weeget",
    arg: true,
    help: "Use /get &lt;BOT&gt; &lt;PACK&gt; to download files.",
  },
];

commands.forEach((command) => {
  bot.command(command.name, (msg, reply, next) => {
    // Check if is needed and display help
    if (command.help && !msg.args()) return reply.html(command.help);

    // Check if command is already running
    if (msg.context.command) return reply.text("A command is already running.");

    // Construct command
    let binary = command.binary || command.name;

    // Run command
    msg.context.command = new Command(
      reply,
      msg.context,
      command.arg ? `${binary} '${msg.args()}'` : binary
    );

    // Remove context
    msg.context.command.on("exit", () => (msg.context.command = null));
  });
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

// Status
bot.command("status", function (msg, reply) {
  var content = "",
    context = msg.context;

  // Running command
  if (!context.command) content += "No command running.\n\n";
  else content += "Command running, PID " + context.command.pty.pid + ".\n\n";

  if (context.command) reply.reply(context.command.initialMessage.id);
  reply.html(content);
});

bot.command(function (msg, reply, next) {
  reply.reply(msg).text("Invalid command.");
});
