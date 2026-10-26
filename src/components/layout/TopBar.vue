<script setup>
// The bar every page screen wears: a brand on the left, everything about you
// on the right, and nothing else.
import SvgIcon from '../ui/SvgIcon.vue';
import BaseButton from '../ui/BaseButton.vue';
import UserMenu from './UserMenu.vue';

defineProps({
  user: { type: Object, default: null },
  menuGroups: { type: Array, default: () => [] },
  // A guest is playing on an account they never asked for, so the way to
  // keep it is offered here rather than hidden in a menu. Somebody already
  // signed in has nothing to do with these.
  showAuth: { type: Boolean, default: false },
  // The session has not resolved yet. The bar is drawn anyway - it is the
  // shell, and the shell does not wait - but its right-hand side holds a
  // placeholder of the same size rather than guessing. Guessing wrong means
  // signed-out buttons flashing at somebody who is signed in, and the bar
  // changing width underneath them when the answer arrives.
  loading: { type: Boolean, default: false },
});
defineEmits(['pick', 'renamed', 'auth']);
</script>

<template>
  <header class="topbar topbar-page">
    <!-- A link, because a brand in a bar is the way back to the front page
         and people try it whether or not it is one. The label covers the
         width where the wordmark is hidden and the mark alone is left. -->
    <a class="brand" href="/" aria-label="CCPoker — home">
      <SvgIcon name="logo" />
      <span class="brand-name">CC<em>Poker</em></span>
    </a>
    <div class="topbar-user">
      <span v-if="loading" class="topbar-wait" aria-hidden="true">
        <span class="sk sk-pill" />
      </span>
      <div v-else-if="showAuth" class="topbar-auth">
        <BaseButton variant="ghost" size="sm" @click="$emit('auth', 'login')">Log in</BaseButton>
        <BaseButton variant="primary" size="sm" @click="$emit('auth', 'signup')">Sign up</BaseButton>
      </div>
      <UserMenu
        v-if="user && !loading"
        :user="user"
        :groups="menuGroups"
        @pick="$emit('pick', $event)"
        @renamed="$emit('renamed', $event)"
      />
    </div>
  </header>
</template>
