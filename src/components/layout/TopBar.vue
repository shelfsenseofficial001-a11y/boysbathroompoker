<script setup>
// The bar every page screen wears: a brand on the left, everything about you
// on the right, and nothing else.
import SvgIcon from '../ui/SvgIcon.vue';
import UserMenu from './UserMenu.vue';

defineProps({
  user: { type: Object, default: null },
  menuGroups: { type: Array, default: () => [] },
});
defineEmits(['pick', 'renamed']);
</script>

<template>
  <header class="topbar topbar-page">
    <div class="brand">
      <SvgIcon name="logo" />
      <span>CC<em>Poker</em></span>
    </div>
    <div class="topbar-user">
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
