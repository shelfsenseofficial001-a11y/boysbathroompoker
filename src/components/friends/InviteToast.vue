<script setup>
// An invite that just arrived, answered where it lands.
//
// The same card a knock at a private room gets (.vote-toast.is-knock): a
// face, a line, and two buttons. It shows wherever the player is - including
// at a table, where the chat window is put away - so an invite is never
// something you have to go looking for.
import { useInvite, dismissInvite } from '../../composables/useInvite.js';
import { avatarSVG } from '../../lib/svg/avatars.js';
import SvgIcon from '../ui/SvgIcon.vue';

const emit = defineEmits(['join']);
const { toasts } = useInvite();

function join(t) {
  emit('join', { code: t.code, invite: t.token });
  dismissInvite(t.id);
}
</script>

<template>
  <div v-if="toasts.length" class="invite-host">
    <div v-for="t in toasts" :key="t.id" class="vote-toast is-knock invite-toast" role="status">
      <div class="vote-top">
        <span class="vote-face">
          <img v-if="t.avatar_url" :src="t.avatar_url" alt="" />
          <span v-else class="contents" v-html="avatarSVG(t.username)" />
        </span>
        <span class="vote-text">
          <b>{{ t.name }}</b>
          <em><SvgIcon name="trophy" />{{ t.line || 'Invited you to their table' }}</em>
        </span>
      </div>
      <div class="vote-acts">
        <button class="vote-btn is-no" @click="dismissInvite(t.id)">Not now</button>
        <button class="vote-btn is-let" @click="join(t)">Join</button>
      </div>
    </div>
  </div>
</template>
