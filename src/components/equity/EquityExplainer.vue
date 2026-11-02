<script setup>
// The calculator's working, shown: why each hand has the equity it has, so a
// player can learn to estimate it at the table.
//
// Two pictures. A hundred squares, one per hundredth of the boards still to
// come, coloured by who wins each - equity *is* that share. And, once there
// is a flop, the street-by-street reasoning a player would do in their head:
// what everyone holds now, which cards to come help the hand being studied
// (its outs), and the rule of 2 and 4 that turns outs into a percentage,
// next to the exact figure so the shortcut can be judged against it.
import { ref, computed, watch } from 'vue';
import { cardFaceSVG } from '../../lib/svg/cards.js';
import { describeHand, nextCardOuts, CATEGORY_NAME } from '../../../shared/equity.mjs';

const props = defineProps({
  // [{ p, hand: [c, c] }] - the seats with both cards, in seat order.
  seats: { type: Array, required: true },
  board: { type: Array, required: true }, // the board cards placed, in order
  dead: { type: Array, default: () => [] }, // cards out of the deck elsewhere
  odds: { type: Object, default: null }, // Map(p -> { win, tie, lose })
  plan: { type: Object, required: true }, // { exact, boards }
  colors: { type: Array, required: true }, // a colour per seat
  deck: { type: String, default: null },
});

const name = (p) => `Player ${p + 1}`;
const fmt = (n) => n.toLocaleString('en-US');
const pct = (v) => (v > 0 && v < 0.1 ? '<0.1' : v > 99.9 && v < 100 ? '>99.9' : v.toFixed(1));
const mini = (c) => cardFaceSVG(c, { simple: true, deck: props.deck });

const ready = computed(() => props.seats.length >= 2 && !!props.odds);

// The hand being studied. Kept while it is still in the calculation.
const focus = ref(null);
watch(
  () => props.seats.map((s) => s.p).join(),
  () => {
    if (!props.seats.some((s) => s.p === focus.value)) focus.value = props.seats[0]?.p ?? null;
  },
  { immediate: true }
);
const focusIndex = computed(() => props.seats.findIndex((s) => s.p === focus.value));
const focusOdds = computed(() => props.odds?.get(focus.value) || null);

// ---- A hundred boards --------------------------------------------------------
// Each seat's share of wins, and the tied share, rounded to whole squares so
// they add up to exactly a hundred (largest remainder).
const squares = computed(() => {
  if (!ready.value) return [];
  const parts = props.seats.map((s) => ({ key: s.p, value: props.odds.get(s.p)?.win || 0 }));
  // Every tie is one board, however many hands share it: the tied share of
  // all boards is what is left once the outright wins are taken out.
  const won = parts.reduce((n, x) => n + x.value, 0);
  parts.push({ key: 'tie', value: Math.max(0, 100 - won) });
  const floors = parts.map((x) => ({ ...x, n: Math.floor(x.value), rest: x.value - Math.floor(x.value) }));
  let left = 100 - floors.reduce((n, x) => n + x.n, 0);
  for (const x of [...floors].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    x.n += 1;
    left -= 1;
  }
  return floors.flatMap((x) => Array.from({ length: x.n }, () => x.key));
});
const colorOf = (key) => (key === 'tie' ? 'var(--eq-tie)' : props.colors[key]);
const tieShare = computed(() => {
  if (!ready.value) return 0;
  const won = props.seats.reduce((n, s) => n + (props.odds.get(s.p)?.win || 0), 0);
  return Math.max(0, 100 - won);
});

const boardsLine = computed(() => {
  const n = props.board.length;
  if (n === 5) return 'The board is complete, so there is only one way it ends: the best hand now is the best hand.';
  if (props.plan.exact) {
    return `There are ${fmt(props.plan.boards)} ways the rest of the board can come. Every one of them is dealt out, and each counts as a win for whoever holds the best hand at the end.`;
  }
  return `Before the flop there are well over a million ways the board can come - too many to count each time - so ${fmt(props.plan.boards)} random boards are dealt and counted instead. That is accurate to within about half a percent.`;
});

// ---- The equation -----------------------------------------------------------
// The studied hand's result as the sum it is: boards won and split over
// boards dealt, and equity as the wins plus its part of each split pot.
const FRACTION = { 2: '½', 3: '⅓', 4: '¼', 5: '⅕', 6: '⅙', 7: '⅐', 8: '⅛', 9: '⅑' };
const sum = computed(() => {
  const e = focusOdds.value;
  if (!e || !e.boards) return null;
  const splitPart = (e.share / e.boards) * 100;
  // Every split the same size (the usual case: two hands chopping) reads as
  // a plain fraction; a mix of sizes is given as the part it comes to.
  const ways = e.ties ? e.ties / e.share : 0;
  const even = e.ties && Math.abs(ways - Math.round(ways)) < 1e-6 ? Math.round(ways) : 0;
  return { ...e, splitPart, fraction: even ? FRACTION[even] || `1/${even}` : '' };
});

// What its wins are made of: each kind of hand it wins with, as a share of
// all boards, so the bars add up to its win percentage.
const madeOf = computed(() => {
  const e = focusOdds.value;
  if (!e?.byCategory || !e.wins) return [];
  const top = Math.max(...e.byCategory);
  return e.byCategory
    .map((n, cat) => ({ cat, name: CATEGORY_NAME[cat], n, pct: (n / e.boards) * 100, width: (n / top) * 100 }))
    .filter((r) => r.n > 0)
    .reverse();
});

// ---- Pre-flop, head to head ---------------------------------------------------
// Two hands before the flop fall into a handful of well-known shapes, each
// with a figure worth knowing by heart. Which shape this is, said from the
// studied hand's side, with that figure - so the counted number has a reason.
const RANK_VALUE = { A: 14, K: 13, Q: 12, J: 11, T: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2 };
const RANK_LABEL = { 14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: 'Ten', 9: 'Nine', 8: 'Eight', 7: 'Seven', 6: 'Six', 5: 'Five', 4: 'Four', 3: 'Three', 2: 'Two' };
const article = (v) => (v === 14 || v === 8 ? 'an' : 'a');

const matchup = computed(() => {
  if (props.seats.length !== 2 || props.board.length || focusIndex.value < 0) return null;
  const mine = props.seats[focusIndex.value].hand;
  const theirs = props.seats[1 - focusIndex.value].hand;
  const other = name(props.seats[1 - focusIndex.value].p);
  const vals = (h) => h.map((c) => RANK_VALUE[c[0]]).sort((a, b) => b - a);
  const [a1, a2] = vals(mine);
  const [b1, b2] = vals(theirs);
  const suited = (h) => h[0][1] === h[1][1];
  const R = RANK_LABEL;

  let shape;
  if (a1 === a2 && b1 === b2) {
    shape = a1 > b1
      ? { title: 'Pair over pair', line: `${R[a1]}s against ${R[b1]}s: the higher pair is a big favourite, and the lower one mostly needs to hit a set.`, rule: 'about 80 / 20' }
      : { title: 'Pair under pair', line: `${R[a1]}s against ${R[b1]}s: the lower pair is a big underdog, and mostly needs to hit a set.`, rule: 'about 20 / 80' };
  } else if (a1 === a2 || b1 === b2) {
    const pairIsMine = a1 === a2;
    const pair = pairIsMine ? a1 : b1;
    const [h1, h2] = pairIsMine ? [b1, b2] : [a1, a2];
    const overs = (h1 > pair) + (h2 > pair);
    const rule = overs === 2 ? 55 : overs === 1 ? 70 : 85;
    const what = overs === 2 ? 'two higher cards' : overs === 1 ? 'one higher card' : 'two lower cards';
    const story = overs === 2
      ? 'The pair is ahead now, but either of the higher cards pairing on the board beats it - close to a coin flip.'
      : overs === 1
        ? 'Only one card can pair to beat the pair, so the pair is a clear favourite.'
        : 'Neither card can pair to beat it - the other hand needs straights, flushes or two pair.';
    shape = { title: `A pair against ${what}`, line: story, rule: pairIsMine ? `about ${rule} / ${100 - rule}` : `about ${100 - rule} / ${rule}` };
  } else {
    const shared = [a1, a2].find((v) => v === b1 || v === b2);
    if (shared) {
      const myKick = a1 === shared ? a2 : a1;
      const theirKick = b1 === shared ? b2 : b1;
      const ahead = myKick > theirKick;
      shape = {
        title: ahead ? 'Dominating' : 'Dominated',
        line: `Both hold ${article(shared)} ${R[shared]}, so that card cancels out and the other one decides most boards: ${R[ahead ? myKick : theirKick]} beats ${R[ahead ? theirKick : myKick]}. The ${ahead ? `trailing hand mostly needs its ${R[theirKick]} to pair` : `${R[myKick]} mostly needs to pair`}.`,
        rule: ahead ? 'about 70 / 30' : 'about 30 / 70',
      };
    } else if (a2 > b1 || b2 > a1) {
      const over = a2 > b1;
      shape = {
        title: over ? 'Two higher cards' : 'Two lower cards',
        line: over
          ? 'Both cards are higher than both of theirs. Pairing either one wins, and so does high card when nobody improves.'
          : 'Both cards are lower than both of theirs, so pairing one is not always enough.',
        rule: over ? 'about 65 / 35' : 'about 35 / 65',
      };
    } else {
      const ahead = a1 > b1;
      shape = {
        title: 'Interleaved cards',
        line: `The ${ahead ? 'top card is the highest at the table, which gives a small edge' : 'highest card at the table is theirs, which gives them a small edge'}: each hand has one card the other can't beat.`,
        rule: ahead ? 'about 55 / 45' : 'about 45 / 55',
      };
    }
  }
  const suitNote = suited(mine) && !suited(theirs)
    ? 'Being suited adds roughly 2 to 3 points, from flushes.'
    : !suited(mine) && suited(theirs)
      ? `${other} is suited, which takes roughly 2 to 3 points from this side.`
      : '';
  return { ...shape, other, suitNote };
});

// ---- Where the studied hand stands --------------------------------------------
const street = computed(() => ({ 0: 'preflop', 3: 'flop', 4: 'turn', 5: 'river' })[props.board.length] || 'partial');
const toCome = computed(() => 5 - props.board.length);

// What every hand is right now, best first, once there is a flop to make one.
const made = computed(() => {
  if (props.board.length < 3) return [];
  const rows = props.seats.map((s) => ({ p: s.p, ...describeHand([...s.hand, ...props.board]) }));
  const best = Math.max(...rows.map((r) => r.score));
  const leaders = rows.filter((r) => r.score === best).length;
  return rows
    .map((r) => ({ ...r, ahead: r.score === best && leaders === 1, tied: r.score === best && leaders > 1 }))
    .sort((a, b) => b.score - a.score);
});
const focusMade = computed(() => made.value.find((r) => r.p === focus.value) || null);

// Outs on the very next card, for the flop and the turn.
const outs = computed(() => {
  if (!ready.value || focusIndex.value < 0 || !['flop', 'turn'].includes(street.value)) return null;
  return nextCardOuts(
    props.seats.map((s) => s.hand),
    props.board,
    props.dead,
    focusIndex.value
  );
});
const nextName = computed(() => (street.value === 'flop' ? 'turn' : 'river'));
// The cards that would take the lead away from a hand that has it.
const danger = computed(() => {
  if (!outs.value) return [];
  const safe = new Set([...outs.value.outs, ...outs.value.splits]);
  const seen = new Set([...props.seats.flatMap((s) => s.hand), ...props.board, ...props.dead]);
  const ranks = 'AKQJT98765432';
  const all = [];
  for (const r of ranks) for (const s of 'shdc') all.push(r + s);
  return all.filter((c) => !seen.has(c) && !safe.has(c));
});
const ruleOf = computed(() => (toCome.value === 2 ? 4 : 2));
const ruleEstimate = computed(() => (outs.value ? Math.min(100, outs.value.outs.length * ruleOf.value) : 0));
const oneCardExact = computed(() => (outs.value ? (outs.value.outs.length / outs.value.unseen) * 100 : 0));
</script>

<template>
  <section class="eq-learn" aria-labelledby="eq-learn-title">
    <h2 id="eq-learn-title" class="eq-learn-title">How the odds are worked out</h2>

    <!-- The heading stays put and the working scrolls under it, so the panel
         keeps its own shape however much there is to read in it. -->
    <div class="eq-learn-body">
    <p v-if="!ready" class="eq-learn-empty">
      Give two or more players both their cards. This panel then shows where each hand’s percentage comes from,
      and how to estimate it yourself at the table.
    </p>

    <template v-else>
      <!-- Which hand to study. -->
      <div class="eq-learn-seats" role="radiogroup" aria-label="Hand to explain">
        <button
          v-for="s in seats"
          :key="s.p"
          type="button"
          role="radio"
          class="eq-learn-seat"
          :class="{ 'is-on': focus === s.p }"
          :aria-checked="focus === s.p"
          :style="{ '--seat-c': colors[s.p] }"
          @click="focus = s.p"
        >
          <i class="eq-dot" />{{ name(s.p) }}
        </button>
      </div>

      <!-- 1. Equity is a share of boards. -->
      <div class="eq-learn-block">
        <h3 class="eq-learn-h">1 · Equity is a share of the boards to come</h3>
        <div class="eq-share">
        <div class="eq-waffle" role="img" :aria-label="`Out of 100 boards: ${seats.map((s) => `${name(s.p)} wins ${Math.round(odds.get(s.p)?.win || 0)}`).join(', ')}, ${Math.round(tieShare)} tied`">
          <i
            v-for="(key, i) in squares"
            :key="i"
            :class="{ 'is-focus': key === focus, 'is-tie': key === 'tie' }"
            :style="{ background: colorOf(key) }"
          />
        </div>
        <ul class="eq-legend">
          <li v-for="s in seats" :key="s.p" :class="{ 'is-on': focus === s.p }">
            <i class="eq-dot" :style="{ '--seat-c': colors[s.p] }" />{{ name(s.p) }}
            <b>{{ pct(odds.get(s.p)?.win || 0) }}%</b>
          </li>
          <li v-if="tieShare >= 0.05"><i class="eq-dot is-tie" />Split pot <b>{{ pct(tieShare) }}%</b></li>
        </ul>
        </div>
        <p class="eq-learn-p">
          Each square is one board in a hundred. {{ boardsLine }}
          <template v-if="focusOdds">
            <strong>{{ name(focus) }}</strong> wins {{ pct(focusOdds.win) }}% of them<template v-if="focusOdds.tie >= 0.05"> and splits {{ pct(focusOdds.tie) }}%</template>.
          </template>
        </p>
      </div>

      <!-- 2. The sum behind the number. -->
      <div v-if="sum" class="eq-learn-block">
        <h3 class="eq-learn-h">2 · The equation for {{ name(focus) }}</h3>
        <div class="eq-eq">
          <div class="eq-eq-row">
            <span class="eq-eq-label">Won</span>
            <span class="eq-eq-math">{{ fmt(sum.wins) }} ÷ {{ fmt(sum.boards) }}</span>
            <b>{{ pct(sum.win) }}%</b>
          </div>
          <div class="eq-eq-row">
            <span class="eq-eq-label">Split</span>
            <span class="eq-eq-math">{{ fmt(sum.ties) }} ÷ {{ fmt(sum.boards) }}</span>
            <b>{{ pct(sum.tie) }}%</b>
          </div>
          <div class="eq-eq-row">
            <span class="eq-eq-label">Lost</span>
            <span class="eq-eq-math">{{ fmt(sum.boards - sum.wins - sum.ties) }} ÷ {{ fmt(sum.boards) }}</span>
            <b>{{ pct(sum.lose) }}%</b>
          </div>
          <div class="eq-eq-total">
            <span class="eq-eq-label">Equity</span>
            <span class="eq-eq-math">
              <template v-if="sum.ties">
                {{ pct(sum.win) }}% + {{ pct(sum.tie) }}%<template v-if="sum.fraction"> × {{ sum.fraction }}</template><template v-else> × their part</template>
              </template>
              <template v-else>{{ pct(sum.win) }}% + 0</template>
            </span>
            <b>{{ pct(sum.equity) }}%</b>
          </div>
        </div>
        <p class="eq-learn-p">
          Equity is the share of the pot a hand wins on average: every board it wins outright counts in full,
          and every board it splits counts for its part of the pot<template v-if="sum.fraction"> ({{ sum.fraction }} when it is shared {{ sum.fraction === '½' ? 'two' : 'that many' }} ways)</template>.
          The number on the seat is the first line, boards won outright.
        </p>
      </div>

      <!-- 3. What those wins are made of. -->
      <div v-if="madeOf.length" class="eq-learn-block">
        <h3 class="eq-learn-h">3 · What the {{ pct(sum.win) }}% is made of</h3>
        <p class="eq-learn-p">
          Every board {{ name(focus) }} wins, sorted by the hand they win it with. The bars add up to their
          {{ pct(sum.win) }}%.
        </p>
        <ul class="eq-madeof">
          <li v-for="r in madeOf" :key="r.cat">
            <span class="eq-madeof-name">{{ r.name }}</span>
            <span class="eq-madeof-bar"><i :style="{ width: `${r.width}%`, background: colors[focus] }" /></span>
            <b>{{ pct(r.pct) }}%</b>
          </li>
        </ul>
      </div>

      <!-- 4. What the hand is now, and what can change it. -->
      <div class="eq-learn-block">
        <h3 class="eq-learn-h">{{ madeOf.length ? 4 : 3 }} · Where {{ name(focus) }} stands</h3>

        <template v-if="street === 'preflop' && matchup">
          <div class="eq-matchup">
            <span class="eq-matchup-kind">{{ matchup.title }}</span>
            <span class="eq-matchup-rule">Rule of thumb: <b>{{ matchup.rule }}</b></span>
          </div>
          <p class="eq-learn-p">{{ matchup.line }}</p>
          <p v-if="matchup.suitNote" class="eq-learn-p">{{ matchup.suitNote }}</p>
          <div class="eq-math">
            <div class="eq-math-row"><span>Rule of thumb</span><b>{{ matchup.rule.replace('about ', '≈ ') }}</b></div>
            <div class="eq-math-row"><span>Counted equity</span><b>{{ pct(focusOdds?.equity ?? focusOdds?.win ?? 0) }}%</b></div>
          </div>
        </template>

        <template v-else-if="street === 'preflop'">
          <p class="eq-learn-p">
            With no board yet there are no made hands to compare, only cards. What decides a pre-flop matchup is
            how often each hand pairs, makes a straight or flush, or holds up by being higher. That is why it is
            counted rather than reasoned out.
          </p>
          <p class="eq-learn-tip">
            <b>Rules of thumb:</b> a pair against two higher cards is about a coin flip (55/45). A pair against
            a lower pair wins about 80%. Two high cards against two lower ones win about 65%.
          </p>
        </template>

        <template v-else-if="street === 'partial'">
          <p class="eq-learn-p">Deal the full flop (three cards) to see the hands each player has made.</p>
        </template>

        <template v-else>
          <!-- Everyone's hand right now. -->
          <ol class="eq-made">
            <li v-for="r in made" :key="r.p" :class="{ 'is-on': r.p === focus }">
              <i class="eq-dot" :style="{ '--seat-c': colors[r.p] }" />
              <span class="eq-made-who">{{ name(r.p) }}</span>
              <span class="eq-made-hand">{{ r.description }}</span>
              <span v-if="r.ahead" class="eq-made-tag is-ahead">Ahead</span>
              <span v-else-if="r.tied" class="eq-made-tag">Tied</span>
            </li>
          </ol>

          <!-- The river: nothing left to come. -->
          <p v-if="street === 'river'" class="eq-learn-p">
            No cards are left to come, so equity is all or nothing.
            <template v-if="focusMade?.ahead"><strong>{{ name(focus) }}</strong> has the best hand and wins 100%.</template>
            <template v-else-if="focusMade?.tied"><strong>{{ name(focus) }}</strong> shares the best hand, so the pot is split.</template>
            <template v-else><strong>{{ name(focus) }}</strong> is beaten, and has 0%.</template>
          </p>

          <!-- Flop and turn: outs. -->
          <template v-else-if="outs">
            <template v-if="!focusMade?.ahead">
              <p class="eq-learn-p">
                <strong>{{ name(focus) }}</strong> is behind. Their <b>outs</b> are the cards that would put them
                ahead on the {{ nextName }}:
                <b>{{ outs.outs.length }}</b> of the {{ outs.unseen }} cards still unseen.
              </p>
              <div v-if="outs.outs.length" class="eq-outs">
                <span v-for="c in outs.outs" :key="c" class="eq-mini" v-html="mini(c)" />
              </div>
              <p v-else class="eq-learn-p">No single card puts them ahead on the {{ nextName }}.</p>
            </template>
            <template v-else>
              <p class="eq-learn-p">
                <strong>{{ name(focus) }}</strong> is ahead. These <b>{{ danger.length }}</b> of the {{ outs.unseen }}
                unseen cards would put someone else ahead on the {{ nextName }}:
              </p>
              <div v-if="danger.length" class="eq-outs is-danger">
                <span v-for="c in danger" :key="c" class="eq-mini" v-html="mini(c)" />
              </div>
            </template>

            <!-- Turning outs into a percentage. -->
            <div v-if="!focusMade?.ahead" class="eq-math">
              <template v-if="toCome === 1">
                <div class="eq-math-row">
                  <span>Exact</span>
                  <b>{{ outs.outs.length }} ÷ {{ outs.unseen }} = {{ pct(oneCardExact) }}%</b>
                </div>
                <div class="eq-math-row">
                  <span>Rule of 2</span>
                  <b>{{ outs.outs.length }} × 2 ≈ {{ ruleEstimate }}%</b>
                </div>
                <p class="eq-learn-tip">
                  With one card to come, outs divided by unseen cards <em>is</em> the chance of winning. Doubling
                  the outs gets close enough to do in your head.
                </p>
              </template>
              <template v-else>
                <div class="eq-math-row">
                  <span>Rule of 4</span>
                  <b>{{ outs.outs.length }} × 4 ≈ {{ ruleEstimate }}%</b>
                </div>
                <div class="eq-math-row">
                  <span>Counted</span>
                  <b>{{ pct(focusOdds?.win || 0) }}%</b>
                </div>
                <p class="eq-learn-tip">
                  With the turn and the river both to come, a hand gets two tries at its outs, so multiply by 4.
                  The shortcut leaves two things out that the count includes: draws that need both cards to come,
                  and outs that arrive only for another hand to improve past them on the river. That is why the
                  two figures differ.
                </p>
              </template>
            </div>
          </template>
        </template>
      </div>
    </template>
    </div>
  </section>
</template>
