<script setup>
// A player's page, as anyone with the link sees it.
//
// Composed from two places that know nothing about each other: identity from
// Supabase's `public_profiles` view, and the record from this server's own
// results table. One Supabase auth id joins them, and either half may fail
// without taking the other down - a stats endpoint that is down should cost
// the graphs, not the name and the face.
//
// Guests are not here, and this is the one page where that has to be said
// out loud rather than merely implemented. A guest has no row in `profiles`
// at all (migration 0004), so a guest's own URL finds nothing, exactly as a
// stranger's would - and the page says which of those happened, since
// "you don't have one of these" and "this person doesn't" are different
// sentences and only one of them is an offer.
import { ref, computed, watch, onMounted } from 'vue';
import { useAuth } from '../../composables/useAuth.js';
import { profileByUsername, statsFor, recentFor, profileUrl } from '../../lib/publicProfile.js';
import { summarize, cumulativeNet, rollingWinRate, wonLostPerGame, formatRatio, ratioSplit } from '../../../shared/stats.mjs';
import { initialsFrom } from '../../../shared/profileFields.mjs';
import { avatarSVG } from '../../lib/svg/avatars.js';
import { grouped } from '../../lib/format.js';
import { showToast } from '../../lib/toast.js';
import SvgIcon from '../ui/SvgIcon.vue';
import BaseButton from '../ui/BaseButton.vue';
import LineGraph from './LineGraph.vue';

const props = defineProps({
  // The name out of /u/:username.
  username: { type: String, required: true },
});
const emit = defineEmits(['auth', 'home', 'edit']);

const auth = useAuth();

const loading = ref(true);
const profile = ref(null);
const stats = ref(null);
const statsError = ref('');
const recent = ref([]);
const recentTotal = ref(0);
const loadingMore = ref(false);

// Whose page this is. An owner gets the way to edit it and nobody else does.
const isOwner = computed(
  () => !!profile.value && auth.hasAccount.value && auth.userId.value === profile.value.id
);
// A guest looking at a page that does not exist - theirs, or anyone's. The
// page has something to offer them that it has nothing to offer a stranger.
const viewerIsGuest = computed(() => auth.isGuest.value);

const displayName = computed(() => profile.value?.ingame_name || profile.value?.username || '');
const initials = computed(() => initialsFrom(displayName.value));
const memberSince = computed(() => {
  const at = profile.value?.created_at;
  if (!at) return '';
  return new Date(at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
});

const summary = computed(() => stats.value?.summary || summarize([]));
const rows = computed(() => stats.value?.results || []);
const split = computed(() => ratioSplit(summary.value));
const hasGames = computed(() => summary.value.gamesPlayed > 0);

const netSeries = computed(() => [
  { name: 'Net', points: cumulativeNet(rows.value) },
]);
const rateSeries = computed(() => [
  { name: 'Win rate', points: rollingWinRate(rows.value) },
]);
const wonLostSeries = computed(() => {
  const { won, lost } = wonLostPerGame(rows.value);
  return [
    { name: 'Won', points: won },
    { name: 'Lost', points: lost },
  ];
});

const cards = computed(() => [
  { label: 'Games played', value: grouped(summary.value.gamesPlayed) },
  { label: 'Chips won', value: grouped(summary.value.chipsWon), tone: 'up' },
  { label: 'Chips lost', value: grouped(summary.value.chipsLost), tone: 'down' },
  {
    label: 'Net',
    value: `${summary.value.net > 0 ? '+' : ''}${grouped(summary.value.net)}`,
    tone: summary.value.net > 0 ? 'up' : summary.value.net < 0 ? 'down' : '',
  },
  { label: 'Won : lost', value: formatRatio(summary.value.ratio) },
  {
    label: 'Win rate',
    value: summary.value.winRate === null ? '—' : `${Math.round(summary.value.winRate * 100)}%`,
  },
]);

async function load() {
  loading.value = true;
  profile.value = null;
  stats.value = null;
  statsError.value = '';
  recent.value = [];
  try {
    profile.value = await profileByUsername(props.username);
  } catch {
    // A view that cannot be read is the same to a reader as a name that is
    // not there. Both end on the "no profile" card rather than on a stack
    // trace, and the page says nothing it cannot stand behind.
    profile.value = null;
  }
  loading.value = false;
  if (!profile.value) return;

  // The record, after the name: the header can be drawn without it, and a
  // slow stats call should not hold up the part of the page that is ready.
  try {
    stats.value = await statsFor(profile.value.id);
    const page = await recentFor(profile.value.id, { limit: 10, offset: 0 });
    recent.value = page.results;
    recentTotal.value = page.total;
  } catch (err) {
    statsError.value = err.message;
  }
}

async function showMore() {
  if (!profile.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const page = await recentFor(profile.value.id, { limit: 10, offset: recent.value.length });
    recent.value = [...recent.value, ...page.results];
    recentTotal.value = page.total;
  } catch (err) {
    showToast(err.message);
  } finally {
    loadingMore.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(profileUrl(profile.value.username));
    showToast('Profile link copied.', { info: true });
  } catch {
    showToast("Couldn't copy the link.");
  }
}

const when = (at) => (at ? new Date(at).toLocaleDateString() : '');
const place = (n) => {
  if (!n) return '';
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
};

onMounted(load);
watch(() => props.username, load);
</script>

<template>
  <main class="page profile-page">
    <!-- Loading. A skeleton of the shape that is coming, so the page does
         not jump when it arrives. -->
    <div v-if="loading" class="prof-head" aria-busy="true">
      <span class="sk sk-avatar" />
      <div class="prof-head-text">
        <span class="sk sk-line" />
        <span class="sk sk-line sk-short" />
      </div>
    </div>

    <!-- Nobody by that name. Two cards, because a guest is being told
         something different from a visitor: one is an offer, the other is a
         fact. -->
    <section v-else-if="!profile" class="panel prof-none">
      <template v-if="viewerIsGuest">
        <h1 class="prof-none-title">Create an account to get a profile</h1>
        <p class="prof-none-text">
          Guests play the same game, but there's nothing to keep: no picture, no bio, and no
          record of how your matches went. An account has all three.
        </p>
        <div class="prof-none-acts">
          <BaseButton variant="primary" @click="emit('auth', 'signup')">Sign up</BaseButton>
          <BaseButton @click="emit('auth', 'login')">Log in</BaseButton>
        </div>
      </template>
      <template v-else>
        <h1 class="prof-none-title">This player doesn't have a profile</h1>
        <p class="prof-none-text">
          The name <b>{{ username }}</b> doesn't belong to an account. Names can be changed, so a
          link that worked before may point somewhere that has moved.
        </p>
        <div class="prof-none-acts">
          <BaseButton @click="emit('home')">Go to the front page</BaseButton>
        </div>
      </template>
    </section>

    <template v-else>
      <header class="prof-head">
        <span class="prof-avatar">
          <img v-if="profile.avatar_url" :src="profile.avatar_url" :alt="`${displayName}'s picture`" />
          <span v-else-if="initials" class="prof-initials" aria-hidden="true">{{ initials }}</span>
          <span v-else class="contents" v-html="avatarSVG(profile.username)" />
        </span>
        <div class="prof-head-text">
          <h1 class="prof-name">{{ displayName }}</h1>
          <p class="prof-handle">@{{ profile.username }}</p>
          <p v-if="memberSince" class="prof-since">Member since {{ memberSince }}</p>
          <!-- Plain text, with its line breaks kept. Never v-html: a bio is
               somebody else's writing on a page anyone can open. -->
          <p v-if="profile.bio" class="prof-bio">{{ profile.bio }}</p>
        </div>
        <div class="prof-head-acts">
          <BaseButton size="sm" @click="copyLink"><SvgIcon name="copy" />Copy profile link</BaseButton>
          <BaseButton v-if="isOwner" size="sm" variant="ghost" @click="emit('edit')">
            <SvgIcon name="pencil" />Edit profile
          </BaseButton>
        </div>
      </header>

      <section class="panel prof-stats" aria-labelledby="prof-stats-title">
        <div class="prof-section-head">
          <h2 id="prof-stats-title" class="prof-section-title">Record</h2>
          <span
            class="prof-info"
            tabindex="0"
            role="note"
            aria-label="Results from finished matches. Chips don't carry between tables."
            data-tip="Results from finished matches. Chips don't carry between tables."
          >?</span>
        </div>

        <p v-if="statsError" class="prof-error">{{ statsError }}</p>

        <div class="prof-cards">
          <div v-for="card in cards" :key="card.label" class="prof-card" :class="card.tone && `is-${card.tone}`">
            <span class="prof-card-value">{{ card.value }}</span>
            <span class="prof-card-label">{{ card.label }}</span>
          </div>
        </div>

        <!-- The ratio again, as a shape. Both halves are labelled in words,
             so the bar is not the only way to read which is which. -->
        <div v-if="hasGames" class="prof-split">
          <div
            class="prof-split-bar"
            role="img"
            :aria-label="`Chips won ${grouped(summary.chipsWon)}, chips lost ${grouped(summary.chipsLost)}.`"
          >
            <span class="prof-split-won" :style="{ width: `${split.won}%` }" />
            <span class="prof-split-lost" :style="{ width: `${split.lost}%` }" />
          </div>
          <div class="prof-split-keys">
            <span class="prof-split-key is-won">Won {{ grouped(summary.chipsWon) }}</span>
            <span class="prof-split-key is-lost">Lost {{ grouped(summary.chipsLost) }}</span>
          </div>
        </div>
      </section>

      <section v-if="hasGames" class="panel prof-graphs" aria-labelledby="prof-graphs-title">
        <div class="prof-section-head">
          <h2 id="prof-graphs-title" class="prof-section-title">Over time</h2>
          <p v-if="stats && stats.total > stats.window" class="prof-section-note">
            Last {{ stats.window }} of {{ grouped(stats.total) }} games
          </p>
        </div>
        <LineGraph title="Net chips, running total" :series="netSeries" unit="chips" zero-baseline />
        <LineGraph title="Win rate over games" :series="rateSeries" unit="rate" />
        <LineGraph title="Chips won and lost per game" :series="wonLostSeries" unit="chips" />
      </section>

      <section class="panel prof-recent" aria-labelledby="prof-recent-title">
        <h2 id="prof-recent-title" class="prof-section-title">Recent games</h2>

        <p v-if="!hasGames" class="prof-empty">No finished games yet.</p>

        <ol v-else class="prof-games">
          <li v-for="row in recent" :key="row.id" class="prof-game">
            <span class="prof-game-when">{{ when(row.ended_at) }}</span>
            <span class="prof-game-mode">{{ row.mode || 'Casual' }}</span>
            <span class="prof-game-place">{{ place(row.placement) }}</span>
            <span class="prof-game-net" :class="row.net_chips > 0 ? 'is-up' : row.net_chips < 0 ? 'is-down' : ''">
              <!-- Sign, colour and an arrow. Any one of the three carries it
                   on its own, which is the rule for anything a colour says. -->
              <SvgIcon :name="row.net_chips >= 0 ? 'raise' : 'fold'" />
              {{ row.net_chips > 0 ? '+' : '' }}{{ grouped(row.net_chips) }}
            </span>
          </li>
        </ol>

        <BaseButton
          v-if="recent.length < recentTotal"
          size="sm"
          :disabled="loadingMore"
          @click="showMore"
        >
          {{ loadingMore ? 'Loading…' : 'Show more' }}
        </BaseButton>
      </section>
    </template>
  </main>
</template>
