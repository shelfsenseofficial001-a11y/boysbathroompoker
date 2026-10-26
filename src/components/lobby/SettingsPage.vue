<script setup>
// Settings is a page of its own rather than one more panel at the foot of the
// lobby: it has nothing to do with hosting or joining a game.
//
// Everything here is the player's own and none of it is sent to the server -
// two people at one table can sit at different-looking felts without
// disagreeing about the game.
import { ref, computed } from 'vue';
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

function onMotion() {
  toggleMotion();
  animations.value = !motionReduced();
}
function onSound() {
  toggleSound();
  sounds.value = !soundMuted();
}

// Grouped, because the second group is about you rather than about the
// table. Each group keeps its own heading; the items are the same shape and
// the same button as they always were.
const GROUPS = [
  {
    head: 'Table',
    tabs: [
      { id: 'look', icon: 'sparkle', label: 'Appearance' },
      { id: 'cards', icon: 'eye', label: 'Your cards' },
    ],
  },
  {
    head: 'Account',
    tabs: [{ id: 'profile', icon: 'key', label: 'Profile' }],
  },
  {
    head: 'This device',
    tabs: [{ id: 'feel', icon: 'sliders', label: 'Motion & sound' }],
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
      <BaseButton variant="ghost" size="sm" @click="$emit('back')">
        <SvgIcon name="arrowLeft" /><span>Back</span>
      </BaseButton>
      <h1 class="h1">Settings</h1>
    </div>
    <div class="panel">
      <div class="set-split">
        <nav class="set-nav" role="tablist" aria-label="Settings sections">
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
              <SvgIcon :name="t.icon" /><span>{{ t.label }}</span>
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
              Kept on this device, like the rest of these.
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
