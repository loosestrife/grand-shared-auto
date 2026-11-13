/* inputs.js — key and mouse bindings, using Quake key names.

     bind('w', '+forward')   a held button:  pressed('forward'), tapped('forward')
     bind('e', 'exit')       a one-shot command: GSA.inputs.handlers.exit = () => ...

   Keys, mouse buttons and the wheel all resolve against the same table. Held
   buttons are refcounted, so two keys bound to one button behave. tapped() is
   true for the frame after a button goes down, even if it was released again
   before the frame ran; the main loop calls endFrame() once per frame. */

const bindings = new Map(), buttons = {}, taps = new Set(), handlers = {};

const bind = (key, cmd) => bindings.set(key.toLowerCase(), cmd);
const pressed = name => (buttons[name] || 0) > 0;
const tapped = name => taps.has(name);
const endFrame = () => taps.clear();

const KEYNAME = { ' ': 'space', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const quakeKey = e =>
  e.type == 'wheel' ? (e.deltaY > 0 ? 'mwheeldown' : 'mwheelup')
  : e.type.startsWith('mouse') ? 'mouse1'
  : KEYNAME[e.key] || e.key.toLowerCase();

function run(cmdString, down) {
  for (const line of cmdString.split(';')) {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (!cmd) continue;
    if (cmd[0] == '+') {
      const b = cmd.slice(1), was = buttons[b] || 0;
      buttons[b] = Math.max(0, was + (down ? 1 : -1));
      if (down && !was) taps.add(b);
    } else if (down && handlers[cmd]) handlers[cmd](...args);
  }
}

const listen = (type, down) => addEventListener(type, e => {
  if (e.repeat) return;
  const cmd = bindings.get(quakeKey(e));
  if (!cmd) return;
  if (down && (cmd.includes('+') || e.type != 'keydown')) e.preventDefault();
  run(cmd, down);
}, { passive: false });

listen('keydown', 1);
listen('mousedown', 1);
listen('wheel', 1);
listen('keyup', 0);
listen('mouseup', 0);
addEventListener('blur', () => { for (const b in buttons) buttons[b] = 0; });

(window.GSA = window.GSA || {}).inputs = { bind, pressed, tapped, endFrame, handlers };
