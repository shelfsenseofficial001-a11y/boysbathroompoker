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
  // 'lobby' | 'equity' | 'friends' | 'profile' | 'settings' | '' - which one is on screen.
  active: { type: String, default: '' },
  // A guest has no profile to go to, so that tab offers them one instead.
  guest: { type: Boolean, default: false },
});
const emit = defineEmits(['pick']);

// The same four places the bar lists on a wide screen, in the same order
// and under the same names. A tray that offered a different set was the
// app disagreeing with itself about where it can be.
//
// "You" stands where the account control stands up there: on a phone there
// is no room beside the brand for a face and a name, so it takes a tab, and
// everything the drawer used to hide sits behind it.
const items = computed(() => [
  { id: 'lobby', icon: 'cards', label: 'Play' },
  { id: 'equity', icon: 'percent', label: 'Equity' },
  { id: 'friends', icon: 'chat', label: 'Friends' },
  props.guest
    ? { id: 'signup', icon: 'key', label: 'You', for: 'profile' }
    : { id: 'profile', icon: 'key', label: 'You', for: 'profile' },
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
      <!-- The mark that says which tab you are on, under the word rather
           than only in its colour. -->
      <i class="bottom-nav-mark" aria-hidden="true"></i>
    </button>
  </nav>
</template>
