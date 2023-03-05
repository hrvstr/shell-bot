/**
 * Attaches to a chat, spawns a pty, attaches it to the terminal emulator
 * and the renderer and manages them. Handles incoming commands & input,
 * and posts complimentary messages such as command itself and output code.
 **/

var util = require("util");
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
  this.pty = pty.spawn(
    context.shell,
    [context.interactive ? "-ic" : "-c", command],
    {
      cols: context.size.columns,
      rows: context.size.rows,
      cwd: context.cwd,
      env: context.env,
    }
  );
  this.termios = new termios.Termios(this.pty._fd);
  this.termios.c_lflag &= ~(tsyms.ISIG | tsyms.IEXTEN);
  this.termios.c_lflag &= ~tsyms.ECHO; // disable ECHO
  this.termios.c_lflag |= tsyms.ICANON | tsyms.ECHONL; // we need it for /end, it needs to be active beforehand
  this.termios.c_iflag =
    (this.termios.c_iflag & ~(tsyms.INLCR | tsyms.IGNCR)) | tsyms.ICRNL; // CR to NL
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
  //FIXME: take additional steps to reduce messages sent to group. do typing actions count?

  // Process command output
  this.pty.on("data", this._ptyData.bind(this));

  // Handle command exit
  this.pty.on("exit", this._exit.bind(this));
}
util.inherits(Command, require("events").EventEmitter);

Command.prototype._ptyData = function _ptyData(chunk) {
  //FIXME: implement some backpressure, for example, read smaller chunks, stop reading if there are >= 20 lines waiting to be pushed, set the HWM
  if (typeof chunk !== "string" && !(chunk instanceof String))
    throw new Error("Expected a String, you liar.");
  this.interacted = true;
  this.terminal.write(chunk, "utf-8", this._update.bind(this));
};

Command.prototype._update = function _update() {
  this.renderer.update();
};

Command.prototype.sendSignal = function sendSignal(signal, group) {
  this.interacted = true;
  this.metaActive = false;
  var pid = this.pty.pid;
  if (group) pid = -pid;
  process.kill(pid, signal);
};

Command.prototype._exit = function _exit(code, signal) {
  this._update();
  this.renderer.flushUnfinished();

  if (signal)
    this.reply.html(
      "\uD83D\uDC80 <strong>Killed</strong> by %s.",
      utils.formatSignal(signal)
    );
  // else if (code === 0)
  //   this.reply.html("\u2705 <strong>Exited</strong> correctly.");
  else if (code !== 0)
    this.reply.html("\u26D4 <strong>Exited</strong> with %s.", code);

  this.emit("exit");
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

exports.Command = Command;
