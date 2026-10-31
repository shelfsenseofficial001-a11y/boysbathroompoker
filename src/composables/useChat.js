// Which chat is open, for the whole page.
//
// One window at a time, Messenger-style, drawn by the app shell so it stays
// open while the player moves between the lobby, Settings and a profile. It
// is put away at a table - the felt needs the corner - and comes back after.
import { ref } from 'vue';

// { id, username, name, avatar_url } of the friend being talked to.
const friend = ref(null);
const minimized = ref(false);

export function openChatWith(who) {
  if (!who?.id) return;
  friend.value = {
    id: who.id,
    username: who.username,
    name: who.name || who.ingame_name || who.username,
    avatar_url: who.avatar_url || '',
  };
  minimized.value = false;
}

export function closeChat() {
  friend.value = null;
  minimized.value = false;
}

export function useChat() {
  return { friend, minimized };
}
