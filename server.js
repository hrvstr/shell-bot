#!/usr/bin/env node
// Starts the bot, handles permissions and chat context,
// interprets commands and delegates the actual command
// running to a Command instance. When started, an owner
// ID should be given.

var path = require("path");
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

var bot = botgram(config.authToken, { agent: utils.createAgent() });
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

const binDir = "/home/dietpi/commands/";

// Commands
const commands = [
  { name: "process" },
  { name: "upload" },
  { name: "list" },
  { name: "scan" },
  { name: "new", binary: `${binDir}jellyget` },
  {
    name: "url",
    binary: "/home/dietpi/.local/bin/yt-dlp --get-url",
    arg: true,
    help: "Use /url &lt;URL&gt; to convert a URL.",
  },
  {
    name: "add",
    binary: `${binDir}whitelist`,
    arg: true,
    help: "Use /add &lt;TITLE&gt; to whitelist shows.",
  },
  {
    name: "get",
    binary: `${binDir}weeget`,
    arg: true,
    help: "Use /get &lt;BOT&gt; &lt;PACK&gt; to download files.",
  },
  {
    name: "search",
    binary: `${binDir}search-get`,
    arg: true,
    help: "Use /get &lt;RELEASE&gt; to search and download files.",
  },
];

commands.forEach((command) => {
  bot.command(command.name, (msg, reply, next) => {
    // Check if arg is needed and display help
    if (command.arg && !msg.args()) return reply.html(command.help);

    // Check if command is already running
    if (msg.context.command) return reply.text("A command is already running.");

    // Construct command
    let binary = command.binary || binDir + command.name;

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

bot.command("token", function (msg, reply, next) {
  if (msg.context.id !== owner) return;
  var token = utils.generateToken();
  tokens[token] = true;
  reply.disablePreview().html("One-time access token generated. The following link can be used to get access to the bot:\n%s\nOr by forwarding me this:", bot.link(token));
  reply.command(true, "start", token);
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
bot.command("status", function (msg, reply, next) {
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
