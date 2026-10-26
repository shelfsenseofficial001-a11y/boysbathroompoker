<script setup>
// The lobby: host a table, join one by code, or pick one off the open list.
// Settings sits behind the avatar menu as a page of its own.
import { ref, onMounted, nextTick } from 'vue';
import { emitAck } from '../../lib/socket.js';
import { showToast } from '../../lib/toast.js';
import { playEntrance } from '../../lib/motion.js';
import TopBar from '../layout/TopBar.vue';
import HostRoomForm from './HostRoomForm.vue';
import JoinRoomForm from './JoinRoomForm.vue';
import RoomList from './RoomList.vue';
import SettingsPage from './SettingsPage.vue';

const props = defineProps({
  user: { type: Object, required: true },
  guest: { type: Boolean, default: false },
  notice: { type: String, default: '' },
});
const emit = defineEmits(['enter-room', 'logout']);

// Everything that isn't "change my name" lives in the menu under the avatar,
// so the bar carries a brand and a name and nothing else.
const menuGroups = [
  [{ id: 'settings', icon: 'gear', label: 'Settings' }],
  [{ id: 'logout', icon: 'leave', label: props.guest ? 'New guest' : 'Log out', danger: true }],
];

const page = ref('main');
const screen = ref(null);
const joinForm = ref(null);
// Why we're back here, when the room ended rather than the player leaving.
const error = ref(props.notice || '');

// Being turned away from a room happens over by the Join button, which is
// nowhere near the line of red text at the foot of the page — so it's said in
// a toast, where it can't be missed.
const fail = (message) => showToast(message, { atPage: true });

async function showPage(name) {
  page.value = name;
  await nextTick();
  window.scrollTo({ top: 0 });
}

function onMenuPick(id) {
  if (id === 'logout') return emit('logout');
  if (id === 'settings') showPage('settings');
}

function entered({ code, notice }) {
  error.value = '';
  emit('enter-room', { code, notice });
}

async function watchRoom(code) {
  error.value = '';
  try {
    const res = await emitAck('spectateRoom', { code });
    emit('enter-room', { code: res.code, notice: 'Watching this game.' });
  } catch (err) {
    fail(err.message);
  }
}

onMounted(() => playEntrance(screen.value));
</script>

<template>
  <div ref="screen" class="screen">
    <TopBar :user="user" :menu-groups="menuGroups" @pick="onMenuPick" />

    <main v-show="page === 'main'" class="page">
      <section class="hero" data-enter>
        <div class="eyebrow">Play-money Texas Hold’em</div>
        <h1 class="display">Pull up a chair.</h1>
        <p class="lead">
          Host a private table or join friends with a room code. Chips are fake — strictly for
          bragging rights.
        </p>
      </section>
      <div class="lobby-grid">
        <HostRoomForm @entered="entered" @fail="fail" />
        <JoinRoomForm ref="joinForm" @entered="entered" @fail="fail" />
      </div>
      <RoomList @join="joinForm?.join($event, true)" @watch="watchRoom" @fail="fail" />
      <p class="error-text" role="alert">{{ error }}</p>
    </main>

    <SettingsPage v-if="page === 'settings'" @back="showPage('main')" />
  </div>
</template>
