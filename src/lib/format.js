// Figures, read the way the table reads them. Shared so the lobby's stakes
// and the dock's stacks can never drift apart.
const MONEY_UNITS = [
  [1e12, 't'],
  [1e9, 'b'],
  [1e6, 'm'],
  [1e3, 'k'],
];

// 1234 -> "1,234"; 1250000 -> "1.25m". Two decimal places at most, floored,
// so a figure never rounds up into chips the player doesn't have.
export const fmt = (n) => {
  const v = Math.trunc(Number(n) || 0);
  const abs = Math.abs(v);
  const unit = MONEY_UNITS.find(([size]) => abs >= size);
  if (!unit) return v.toLocaleString('en-US');
  const [size, suffix] = unit;
  return `${v < 0 ? '-' : ''}${Math.floor(abs / (size / 100)) / 100}${suffix}`;
};

// Full grouping, for the places that have room for it.
export const grouped = (n) => (Number(n) || 0).toLocaleString('en-US');
