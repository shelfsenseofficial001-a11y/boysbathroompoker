// The table a player can invite friends to, if any.
//
// Set by the table while the player is in a room, cleared when they leave, so
// the friends list and the chat's menu know whether "Invite to lobby" has
// anywhere to send somebody. One room at a time - you are in one or none.
import { ref, computed } from 'vue';

// { code, token, line } or null. `line` is the human sentence the invite
// message carries; `token` is the host's, present only for a private room.
const room = ref(null);

export function setInviteRoom(value) {
  room.value = value && value.code ? value : null;
}

// Who to open the picker for, so a press on an empty seat can say "this seat".
const pickerFor = ref(null);
export function openInvitePicker(context = {}) {
  pickerFor.value = { ...context, at: Date.now() };
}
export function closeInvitePicker() {
  pickerFor.value = null;
}

// Invites that have arrived and not yet been answered, newest first. Each is
// a card like the one that greets a knock at a private room: a face, a line,
// and two buttons. Kept here so they survive moving between screens and show
// at a table too, where the chat window is put away.
const toasts = ref([]);

// An invite message just arrived. `friend` is the sender as the friends list
// knows them (name, picture), which the raw message row doesn't carry.
export function receiveInvite(msg, friend) {
  const code = msg?.meta?.code;
  if (!code || toasts.value.some((t) => t.id === msg.id)) return;
  toasts.value = [
    {
      id: msg.id,
      code,
      token: msg.meta.token || '',
      name: friend?.name || friend?.ingame_name || friend?.username || 'A friend',
      username: friend?.username || '',
      avatar_url: friend?.avatar_url || '',
      line: msg.content,
    },
    ...toasts.value,
  ].slice(0, 4);
}

export function dismissInvite(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function clearInvites() {
  toasts.value = [];
}

export function useInvite() {
  return {
    room,
    canInvite: computed(() => !!room.value),
    pickerFor,
    toasts,
  };
}
