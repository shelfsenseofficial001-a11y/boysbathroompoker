<script setup>
// The three places worth a thumb, on a screen held in one hand.
//
// A tray rather than another drawer. The drawer in the top bar (MobileNav)
// is still where the landing page's sections and the way in and out live -
// it is a long list and it belongs behind a button. These three are the ones
// reached often enough that opening a drawer to get at them is the cost, and
// at the bottom of the screen they are where the thumb already is.
//
// Never over the table. The betting dock owns the foot of that screen, and a
// nav bar sitting on top of the fold and raise buttons would be the worst
// place on the page to put anything. The app decides which views get this.
import { computed } from 'vue';
import SvgIcon from '../ui/SvgIcon.vue';

const props = defineProps({
  // 'lobby' | 'friends' | 'profile' | 'settings' | '' - which one is on screen.
  active: { type: String, default: '' },
  // A guest has no profile to go to, so that tab offers them one instead.
  guest: { type: Boolean, default: false },
});
const emit = defineEmits(['pick']);

// The same ids and icons the account menu uses, so the two never disagree
// about what a thing is called or what it looks like.
const items = computed(() => [
  { id: 'lobby', icon: 'trophy', label: 'Lobby' },
  // Beside the lobby on a wide screen; here, the only way to it.
  { id: 'friends', icon: 'chat', label: 'Friends' },
  props.guest
    ? { id: 'signup', icon: 'key', label: 'Account', for: 'profile' }
    : { id: 'profile', icon: 'key', label: 'Profile', for: 'profile' },
  { id: 'settings', icon: 'gear', label: 'Settings' },
]);

const isOn = (item) => props.active === (item.for || item.id);
</script>

<template>
  <nav class="bottom-nav" aria-label="Main">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="bottom-nav-item"
      :class="{ 'is-on': isOn(item) }"
      :aria-current="isOn(item) ? 'page' : undefined"
      @click="emit('pick', item.id)"
    >
      <SvgIcon :name="item.icon" />
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>
