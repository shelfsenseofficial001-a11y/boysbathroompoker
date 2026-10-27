<script setup>
// Settings is a page of its own rather than one more panel at the foot of the
// lobby: it has nothing to do with hosting or joining a game.
//
// Everything here is the player's own and none of it is sent to the server -
// two people at one table can sit at different-looking felts without
// disagreeing about the game.
import { ref, computed, watch, nextTick } from 'vue';
import { useSettings, ZOOM } from '../../composables/useSettings.js';
import { motionReduced, toggleMotion } from '../../lib/motion.js';
import { soundMuted, toggleSound } from '../../lib/sound.js';
import SvgIcon from '../ui/SvgIcon.vue';
import BaseButton from '../ui/BaseButton.vue';
import ThemePicker from '../ui/ThemePicker.vue';
import PeekPreview from './PeekPreview.vue';
import ProfilePage from './ProfilePage.vue';

defineProps({
  user: { type: Object, default: null },
});
defineEmits(['back', 'auth', 'logout', 'renamed']);

const { settings, reset } = useSettings();
const tab = ref('look');

// Motion and sound are not part of the settings object: each keeps its own
// key, because the table reads them directly while it is drawing and cannot
// wait for a reactive store. Mirrored into refs here so a checkbox can bind
// to them, with the toggle functions staying the one place that writes.
const animations = ref(!motionReduced());
const sounds = ref(!soundMuted());

// On a phone the sections are a strip that scrolls sideways, and the one
// you are on can be past the edge of it - opened from the account menu at
// Profile, say, or chosen and then scrolled away from. Bring it into view
// whenever it changes, so the strip always shows where you are.
const navEl = ref(null);
watch(tab, async () => {
  await nextTick();
  navEl.value?.querySelector('.set-tab.is-on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});

// Opened straight at a section, from the account menu.
defineExpose({ showTab: (id) => { tab.value = id; } });

function onMotion() {
  toggleMotion();
  animations.value = !motionReduced();
}
function onSound() {
  toggleSound();
  sounds.value = !soundMuted();
}

// Two groups, sorted by what a player is looking for rather than by where
// a setting happens to be stored. There was a third, "This device", for
// motion and sound - true, since those live in this browser, but nobody goes
// looking for a setting by asking where it is saved. They are about how the
// game feels, so they sit with the rest of the game.
//
// Account first: it is who you are, and the one group whose contents differ
// between a guest and somebody signed in. Each item carries a line saying
// what is inside, so the list can be read rather than clicked through.
const GROUPS = [
  {
    head: 'Account',
    tabs: [{ id: 'profile', icon: 'key', label: 'Profile', hint: 'Name and password' }],
  },
  {
    head: 'Game',
    tabs: [
      { id: 'look', icon: 'sparkle', label: 'Appearance', hint: 'Felt and card backs' },
      { id: 'cards', icon: 'eye', label: 'Cards & peeking', hint: 'How you look at your hand' },
      { id: 'feel', icon: 'sliders', label: 'Motion & sound', hint: 'Animations and sounds' },
    ],
  },
];

// Turning the cards face up takes the whole peek-zoom section out of play.
const zooms = computed(() => settings.peekZoom && !settings.autoReveal);

// The range tracks are painted with a filled portion up to the thumb, which
// CSS can only do from a custom property.
const pct = (value, { min, max }) => `${((value - min) / (max - min)) * 100}%`;
</script>

<template>
  <main class="page page-settings">
    <div class="settings-head">
      <!-- Just the arrow, in a circle. The word is the accessible name, so a
           screen reader still hears "Back" where the eye sees an arrow. -->
      <BaseButton variant="ghost" icon class="settings-back" aria-label="Back" title="Back" @click="$emit('back')">
        <SvgIcon name="arrowLeft" />
      </BaseButton>
      <h1 class="h1">Settings</h1>
    </div>
    <div class="panel">
      <div class="set-split">
        <nav ref="navEl" class="set-nav" role="tablist" aria-label="Settings sections">
          <template v-for="group in GROUPS" :key="group.head">
            <span class="set-nav-head">{{ group.head }}</span>
            <button
              v-for="t in group.tabs"
              :key="t.id"
              type="button"
              class="set-tab"
              :class="{ 'is-on': tab === t.id }"
              role="tab"
              :aria-selected="String(tab === t.id)"
              :title="t.label"
              @click="tab = t.id"
            >
              <SvgIcon :name="t.icon" />
              <span class="set-tab-label">
                {{ t.label }}
                <small class="set-tab-hint">{{ t.hint }}</small>
              </span>
            </button>
          </template>
        </nav>
        <div class="set-pane">
          <section class="set-panel" role="tabpanel" :hidden="tab !== 'look'">
            <h3 class="set-lede">How the table looks to you</h3>
            <p class="set-note">
              Yours alone — everyone at a table can sit at a different-looking felt.
            </p>
            <!-- Nothing of the table is on screen here, so the swatches are
                 the preview: the ring moves and that's the whole of it. -->
            <ThemePicker :active="tab === 'look'" />
          </section>

          <section class="set-panel" role="tabpanel" :hidden="tab !== 'cards'">
            <h3 class="set-lede">How your own cards behave</h3>
            <p class="set-note">
              Only you see this. Nobody at the table is told how you look at your hand.
            </p>
            <label class="switch-row">
              <input v-model="settings.autoReveal" type="checkbox" />
              <span>Turn my cards face up as soon as they're dealt</span>
            </label>
            <p class="help-text" :hidden="!settings.autoReveal">
              Your cards stay open all hand, so there's nothing to peek at and the zoom below is
              switched off. You can still throw them to fold, and the table never sees you looking.
            </p>
            <label class="switch-row">
              <input v-model="settings.peekZoom" type="checkbox" :disabled="settings.autoReveal" />
              <span>Zoom in on my cards when peeking</span>
            </label>
            <label class="switch-row">
              <input v-model="settings.showTutorial" type="checkbox" />
              <span>Show how to play when a game starts</span>
            </label>
            <div class="slider-row" :hidden="!zooms">
              <div class="field">
                <label for="zoom-level">
                  Zoom strength <b>{{ settings.zoomLevel.toFixed(2) }}×</b>
                </label>
                <input
                  id="zoom-level"
                  v-model.number="settings.zoomLevel"
                  class="range"
                  type="range"
                  :min="ZOOM.level.min"
                  :max="ZOOM.level.max"
                  :step="ZOOM.level.step"
                  :style="{ '--pct': pct(settings.zoomLevel, ZOOM.level) }"
                />
              </div>
              <div class="field">
                <label for="zoom-speed">
                  Zoom speed <b>{{ settings.zoomSpeed }} ms</b>
                </label>
                <input
                  id="zoom-speed"
                  v-model.number="settings.zoomSpeed"
                  class="range"
                  type="range"
                  :min="ZOOM.speed.min"
                  :max="ZOOM.speed.max"
                  :step="ZOOM.speed.step"
                  :style="{ '--pct': pct(settings.zoomSpeed, ZOOM.speed) }"
                />
              </div>
              <BaseButton variant="ghost" size="sm" @click="reset()">Reset</BaseButton>
            </div>
            <PeekPreview :active="tab === 'cards'" />
          </section>

          <!-- The same two switches the table carries in its own settings
               sheet, and the same storage behind them: a player who turns
               animations off before they sit down should not have to find
               the toggle again once they have. -->
          <section class="set-panel" role="tabpanel" :hidden="tab !== 'feel'">
            <h3 class="set-lede">Motion and sound</h3>
            <p class="set-note">
              Turn either off if the table feels busy, or to save a slower device some work.
            </p>
            <label class="switch-row">
              <input type="checkbox" :checked="animations" @change="onMotion" />
              <span>
                Animations
                <small>Cards dealing, chips moving, the countdown ring</small>
              </span>
            </label>
            <label class="switch-row">
              <input type="checkbox" :checked="sounds" @change="onSound" />
              <span>
                Sounds
                <small>Chips, the flip of a card, your turn coming round</small>
              </span>
            </label>
          </section>

          <div role="tabpanel" :hidden="tab !== 'profile'">
            <ProfilePage
              :user="user"
              @auth="$emit('auth', $event)"
              @logout="$emit('logout')"
              @renamed="$emit('renamed', $event)"
            />
          </div>
        </div>
      </div>
    </div>
  </main>
</template>
