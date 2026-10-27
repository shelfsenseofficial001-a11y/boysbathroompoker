<script setup>
// The lobby: host a table, join one by code, or pick one off the open list.
// Settings sits behind the avatar menu as a page of its own.
import { ref, onMounted, nextTick } from 'vue';
import { emitAck } from '../../lib/socket.js';
import { showToast } from '../../lib/toast.js';
import { playEntrance } from '../../lib/motion.js';
import HostRoomForm from './HostRoomForm.vue';
import JoinRoomForm from './JoinRoomForm.vue';
import RoomList from './RoomList.vue';
import SettingsPage from './SettingsPage.vue';

const props = defineProps({
  // Null when nobody is signed in. The homepage still renders - it is the
  // page the first-visit sheet and the logged-out state sit on top of, and a
  // sheet floating over an empty screen is the bug this avoids. What it drops
  // is the half that needs a socket: you cannot host or join from here
  // without an identity, and a dead socket would only say so in red.
  user: { type: Object, default: null },
  guest: { type: Boolean, default: false },
  notice: { type: String, default: '' },
});
const emit = defineEmits(['enter-room', 'logout', 'auth']);

// The avatar menu, the auth buttons and the footer all belong to the app
// shell now (src/App.vue), so this screen is only the lobby itself.

// Which of the lobby's two pages is showing. Settings is a page rather than
// a panel at the foot of the list: it has nothing to do with hosting or
// joining a game.
const page = ref('main');
const error = ref('');
const screen = ref(null);
const joinForm = ref(null);
const settings = ref(null);

// `tab` lets the caller land on a particular settings section - the account
// menu's "Profile" is Settings opened at Profile, not a page of its own.
async function showPage(name, tab = null) {
  page.value = name;
  await nextTick();
  if (tab) settings.value?.showTab(tab);
  window.scrollTo({ top: 0 });
}

// A rename from the profile page. The bar reads `user.username`, and the
// avatar is drawn from it, so both follow from this one assignment.
function onRenamed(name) {
  if (props.user) props.user.username = name;
}

// Called by the app shell, whose avatar menu owns the Settings item now.
defineExpose({ showPage });

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
  <div ref="screen" class="lobby-screen">
    <main v-show="page === 'main'" class="page">
      <section class="hero" data-enter>
        <div class="eyebrow">Play-money Texas Hold’em</div>
        <h1 class="display">Pull up a chair.</h1>
        <p class="lead">
          Host a private table or join friends with a room code. Chips are fake — strictly for
          bragging rights.
        </p>
      </section>
      <!-- Hosting and joining go through the socket, so they wait for the
           server's own record of this player. Signed out there is nothing to
           wait for; signed in it is a moment, and saying so beats three dead
           panels. -->
      <template v-if="user">
        <div class="lobby-grid">
          <HostRoomForm @entered="entered" @fail="fail" />
          <JoinRoomForm ref="joinForm" @entered="entered" @fail="fail" />
        </div>
        <RoomList @join="joinForm?.join($event, true)" @watch="watchRoom" @fail="fail" />
        <p class="error-text" role="alert">{{ error }}</p>
      </template>
      <p v-else class="lead lobby-signed-out">Finding your seat…</p>
    </main>

    <SettingsPage
      v-if="page === 'settings'"
      ref="settings"
      :user="user"
      @back="showPage('main')"
      @auth="emit('auth', $event)"
      @logout="emit('logout')"
      @renamed="onRenamed"
    />
  </div>
</template>
