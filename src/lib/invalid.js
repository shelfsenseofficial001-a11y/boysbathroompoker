// Telling a player their input is wrong, on the input itself.
//
// Errors used to be said only in the red line at the foot of a panel or in a
// toast, which left the player reading a complaint with no idea which of four
// fields it was about. A rejected value now marks its own field: red border
// and a short shake, so the message and the field agree.
//
// The shake is information, not decoration - it only ever runs in answer to
// something the player did, never on its own - so it stays under reduced
// motion rules: `.reduce-motion` flattens the animation and the red border
// carries the message alone.

const FLAG = 'is-invalid';

// Removing the class on the next keystroke matters as much as adding it: a
// field left red while it's being retyped is reporting the old value, not
// what's in it now. Only a change clears it - coming back to the field and
// leaving it again doesn't, since the value it was complaining about is still
// sitting there.
function clearOn(el) {
  const off = () => {
    el.classList.remove(FLAG);
    el.removeEventListener('input', off);
  };
  el.addEventListener('input', off);
}

// Restarting the animation needs the class gone for a frame - re-adding it
// while it's already on does nothing, so a second bad value in the same field
// would sit there silently.
export function flagInvalid(el, { focus = false } = {}) {
  if (!el) return;
  // Focus first: moving into the field is what scrolls it into view, and it
  // mustn't happen after the shake has started or the field jumps as it moves.
  if (focus) {
    try {
      el.focus({ preventScroll: true });
      el.select?.();
    } catch {
      // Not focusable (disabled, detached): the border still says it.
    }
  }
  el.classList.remove(FLAG);
  void el.offsetWidth; // forces the restart
  el.classList.add(FLAG);
  clearOn(el);
}

// The same mark for a keystroke that never lands: typing a letter into a
// chips field does nothing, and without this it does nothing *silently*,
// which reads as the field being broken rather than the key being wrong.
export const rejectKey = (el) => flagInvalid(el);

// --- Number fields ---------------------------------------------------------
// Whole-number fields are text inputs, not `type="number"`. A number input
// will not hold a grouped figure at all - a comma makes its value read back
// empty - and a stack worth 23,567,234,324 is unreadable without the commas.
// So the digits are the field's own, the grouping is painted on as they are
// typed, and everything that reads one of these fields goes through
// `readNumber`, which takes the grouping back off.
//
// `inputmode="numeric"` still brings up the number pad on a phone, and the
// guard below keeps anything that isn't a digit out of the field.
const GROUPED = 'input[data-numeric]';
// Fields the typing guard covers. Grouped fields are text inputs, so they
// would fall straight through a check on `type`, while the betting dock's
// amount is still a plain number input and has to stay guarded.
const GUARDED = 'input[data-numeric], input[type="number"]';

export const stripGrouping = (value) => String(value ?? '').replace(/,/g, '');

// 1234567 -> "1,234,567". Only ever applied to a value already known to be a
// whole number, so there is nothing here about decimals.
export function groupDigits(value) {
  const n = Number(stripGrouping(value));
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';
}

// Writes a figure into a field as the field wants to hold it. Everything that
// sets one of these programmatically - the steppers, the blind balancing, the
// auto-blinds - goes through here, so none of them can leave a bare number
// sitting in a field that groups.
export function setNumberValue(input, value) {
  if (!input) return;
  input.value = input.matches(GROUPED) ? groupDigits(value) : String(value);
}

// How many digits sit before `pos` in `text`. Grouping moves the caret about
// as commas come and go, and counting digits rather than characters is what
// puts it back where the typing left it.
function digitsBefore(text, pos) {
  let n = 0;
  for (let i = 0; i < pos; i++) if (text[i] >= '0' && text[i] <= '9') n++;
  return n;
}

function caretAfterDigits(text, count) {
  if (count <= 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] >= '0' && text[i] <= '9' && ++n === count) return i + 1;
  }
  return text.length;
}

// Re-groups a field around whatever was just typed into it, leaving the caret
// against the same digit. An empty field is left empty - it is on its way
// somewhere, and filling in a 0 would fight the typing.
export function regroup(input) {
  const before = input.value;
  const bare = stripGrouping(before);
  if (bare === '' || !/^-?\d+$/.test(bare)) return;
  const next = groupDigits(bare);
  if (next === before) return;
  const keep = digitsBefore(before, input.selectionStart ?? before.length);
  input.value = next;
  try {
    const at = caretAfterDigits(next, keep);
    input.setSelectionRange(at, at);
  } catch {
    // Selection unsupported on this field; the value is still right.
  }
}

// What a whole-number field will accept, read off the element's own min / max
// so there's one rule per field rather than a copy in every caller.
export function numberBounds(input) {
  const min = input.min === '' ? -Infinity : Number(input.min);
  const max = input.max === '' ? Infinity : Number(input.max);
  return { min, max };
}

// True when `text` could still be on its way to a valid number: digits only,
// and a leading minus only where negatives are allowed at all. Checked per
// insertion rather than against the whole value, because a number input won't
// hand over its selection (reading selectionStart on one throws), so there's
// no way to work out what the value is about to be.
export function insertionAllowed(input, text) {
  const { min } = numberBounds(input);
  // Commas are allowed into a grouped field so a figure pasted with its
  // grouping already on lands intact; regrouping then puts them where they
  // belong. A plain number input would only choke on one.
  if (min >= 0 && text.includes('-')) return false;
  return (input.matches(GROUPED) ? /^-?[\d,]*$/ : /^-?\d*$/).test(text);
}

// What the field holds, or null if it doesn't hold a usable whole number.
// `badInput` covers the states a number input won't show you: type `--1000`
// and the value reads back as empty while the field still says `--1000`.
export function readNumber(input) {
  if (input.validity?.badInput) return null;
  const raw = stripGrouping(input.value).trim();
  if (raw === '' || !/^-?\d+$/.test(raw)) return null;
  return Number(raw);
}

// --- Typing guard ----------------------------------------------------------
// Keeps letters, symbols and stray minus signs out of whole-number fields in
// the first place. One delegated listener per screen covers every number
// input in it, including ones drawn later.
//
// `beforeinput` is the hook that sees the text before the field does, and it
// covers typing, pasting and dropping alike; the keydown guard under it is
// for the few keys browsers still let through without one (Firefox fires no
// beforeinput for the spinner keys on a number field).
export function guardNumberFields(root) {
  if (root.dataset.numberGuards) return;
  root.dataset.numberGuards = 'yes';

  root.addEventListener('beforeinput', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.matches(GUARDED)) return;
    // Deletions, undo and the like carry no text and are always fine.
    if (e.data == null) return;
    if (insertionAllowed(el, e.data)) return;
    e.preventDefault();
    rejectKey(el);
  });

  root.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.matches(GUARDED)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (insertionAllowed(el, e.key)) return;
    e.preventDefault();
    rejectKey(el);
  });

  // After the field has taken the keystroke, put the grouping back on.
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.matches(GROUPED)) regroup(el);
  });
}
