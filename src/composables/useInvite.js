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

export function useInvite() {
  return {
    room,
    canInvite: computed(() => !!room.value),
    pickerFor,
  };
}
