<script setup>
// A friend's face, small, with the online dot on it.
//
// The same three-way fallback the profile page draws - their picture, then
// their initials, then the generated avatar from their username - so a
// player looks like themselves everywhere they appear. The dot is steady:
// it says "here", and something pulsing in a list of names is noise.
import { computed } from 'vue';
import { initialsFrom } from '../../../shared/profileFields.mjs';
import { avatarSVG } from '../../lib/svg/avatars.js';

const props = defineProps({
  username: { type: String, default: '' },
  name: { type: String, default: '' },
  url: { type: String, default: '' },
  online: { type: Boolean, default: false },
});

const initials = computed(() => initialsFrom(props.name || props.username));
</script>

<template>
  <span class="friend-avatar">
    <img v-if="url" :src="url" alt="" loading="lazy" />
    <span v-else-if="initials" class="friend-initials" aria-hidden="true">{{ initials }}</span>
    <span v-else class="contents" aria-hidden="true" v-html="avatarSVG(username)" />
    <span v-if="online" class="friend-dot" aria-hidden="true" />
  </span>
</template>
