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
});
defineEmits(['pick', 'renamed', 'auth']);
</script>

<template>
  <header class="topbar topbar-page">
    <div class="brand">
      <SvgIcon name="logo" />
      <span>CC<em>Poker</em></span>
    </div>
    <div class="topbar-user">
      <div v-if="showAuth" class="topbar-auth">
        <BaseButton variant="ghost" size="sm" @click="$emit('auth', 'login')">Log in</BaseButton>
        <BaseButton variant="primary" size="sm" @click="$emit('auth', 'signup')">Sign up</BaseButton>
      </div>
      <UserMenu
        v-if="user"
        :user="user"
        :groups="menuGroups"
        @pick="$emit('pick', $event)"
        @renamed="$emit('renamed', $event)"
      />
    </div>
  </header>
</template>
