<script setup>
// Your account, as opposed to your felt: the settings page's other half.
//
// Two forms, deliberately apart. The names save on their own button and the
// password on its own, so a password you are halfway through typing cannot
// stop you fixing a username, and a refused username cannot swallow a
// password change that was fine.
//
// A guest has neither. They have no profile row at all - see useAuth - so
// there is nothing here to edit, and the only thing worth offering is the
// way to become someone who does.
import { ref, computed, watch } from 'vue';
import { useAuth } from '../../composables/useAuth.js';
import { emitAck } from '../../lib/socket.js';
import {
  checkIngameName,
  checkPasswordChange,
  profileChanges,
  normalizeIngameName,
} from '../../lib/accountRules.mjs';
import BaseButton from '../ui/BaseButton.vue';
import TextField from '../ui/TextField.vue';
import PasswordInput from '../ui/PasswordInput.vue';

const props = defineProps({
  user: { type: Object, default: null },
});
const emit = defineEmits(['auth', 'logout', 'renamed']);

const auth = useAuth();

// A guest, or a session that has gone. Either way there is nothing to edit.
const isGuest = computed(() => auth.isGuest.value || !auth.profile.value);

const username = ref('');
const ingameName = ref('');
const savingProfile = ref(false);
const profileErrors = ref({});
const profileNote = ref('');

const current = ref('');
const next = ref('');
const confirmation = ref('');
const savingPassword = ref(false);
const passwordErrors = ref({});
const passwordNote = ref('');

const usernameField = ref(null);
const ingameField = ref(null);
const currentField = ref(null);
const nextField = ref(null);
const confirmField = ref(null);
const FIELDS = {
  username: usernameField,
  ingameName: ingameField,
  current: currentField,
  next: nextField,
  confirmation: confirmField,
};

// The saved values, which is what "changed" is measured against.
const saved = computed(() => ({
  username: auth.profile.value?.username || '',
  ingameName: auth.profile.value?.ingame_name || '',
}));

// Filled from the profile as it arrives, and again whenever a save moves it.
watch(
  saved,
  (now) => {
    username.value = now.username;
    ingameName.value = now.ingameName;
  },
  { immediate: true }
);

// The username cannot move, so there is only one thing here that can change.
const changes = computed(() =>
  profileChanges({ username: saved.value.username, ingameName: ingameName.value }, saved.value)
);
const canSaveProfile = computed(() => changes.value.any && !savingProfile.value);

function mark(target, field, message) {
  target.value = { [field]: message };
  FIELDS[field].value?.flag();
}

async function saveProfile() {
  if (!canSaveProfile.value) return;
  profileErrors.value = {};
  profileNote.value = '';

  const badIngame = checkIngameName(ingameName.value);
  if (badIngame) return mark(profileErrors, 'ingameName', badIngame);

  savingProfile.value = true;
  try {
    // The in-game name first: it is the reversible one, and the one people
    // actually came here to change.
    if (changes.value.ingameName) {
      const clean = normalizeIngameName(ingameName.value);
      await auth.setIngameName(clean);
      // The table is told separately. The server keeps its own players row
      // and is the authority on what a seat is called, so this is the same
      // path the avatar menu's rename uses - the seat is kept and only the
      // name on it changes, mid-hand or not.
      try {
        const res = await emitAck('setName', { name: clean });
        emit('renamed', res.name);
      } catch (err) {
        profileNote.value = `Saved, but the table still shows your old name: ${err.message}`;
      }
    }

    if (!profileNote.value) profileNote.value = 'Saved.';
  } catch (err) {
    profileErrors.value = { form: err.message };
    // Whatever did not save is still on screen to try again with.
    profileNote.value = '';
  } finally {
    savingProfile.value = false;
  }
}

async function savePassword() {
  if (savingPassword.value) return;
  passwordErrors.value = {};
  passwordNote.value = '';

  const bad = checkPasswordChange({
    current: current.value,
    next: next.value,
    confirmation: confirmation.value,
  });
  if (bad) return mark(passwordErrors, bad.field, bad.message);

  savingPassword.value = true;
  try {
    await auth.changePassword({ current: current.value, next: next.value });
    current.value = '';
    next.value = '';
    confirmation.value = '';
    passwordNote.value = 'Password changed. Any other devices have been signed out.';
  } catch (err) {
    if (/current password is incorrect/i.test(err.message)) {
      mark(passwordErrors, 'current', 'Current password is incorrect');
    } else {
      passwordErrors.value = { form: err.message };
    }
  } finally {
    savingPassword.value = false;
  }
}
</script>

<template>
  <section class="set-panel">
    <!-- A guest: no row, nothing to edit, one thing worth offering. -->
    <template v-if="isGuest">
      <h3 class="set-lede">You’re playing as a guest</h3>
      <p class="set-note">
        This account lasts as long as this browser remembers it. An account keeps your name and
        lets you come back to it from anywhere.
      </p>
      <p class="profile-guest-name">{{ user?.username || 'Guest' }}</p>
      <div class="sheet-actions">
        <BaseButton variant="primary" @click="emit('auth', 'signup')">Create account</BaseButton>
      </div>
    </template>

    <template v-else>
      <h3 class="set-lede">Your account</h3>
      <p class="set-note">
        Your username is how you log in, and it’s fixed once the account exists. Your in-game
        name is what everyone at the table reads — change it as often as you like, and it can be
        the same as somebody else’s.
      </p>

      <form class="profile-form" novalidate @submit.prevent="saveProfile">
        <!-- Read-only, and not merely disabled: it is worth reading and
             worth copying, it just cannot be changed. Supabase refuses the
             synthetic `.internal` login address on its email-change endpoint
             - the same address it accepted at sign-up - so the username and
             the way in cannot be moved together, and moving one without the
             other would lock the owner out. See docs/supabase.md. -->
        <TextField
          ref="usernameField"
          v-model="username"
          label="Username"
          autocomplete="username"
          readonly
          hint="How you log in. This one is fixed — your in-game name is the one to change."
          :disabled="savingProfile"
        />
        <TextField
          ref="ingameField"
          v-model="ingameName"
          label="In-game name"
          autocomplete="nickname"
          :maxlength="20"
          hint="Shown at the table. Share it with whoever you like."
          :error="profileErrors.ingameName"
          :disabled="savingProfile"
        />
        <p v-if="profileErrors.form" class="error-text selectable" role="alert">
          {{ profileErrors.form }}
        </p>
        <p class="ok-text" aria-live="polite">{{ profileNote }}</p>
        <div class="sheet-actions">
          <BaseButton type="submit" variant="primary" :disabled="!canSaveProfile">
            {{ savingProfile ? 'Saving…' : 'Save' }}
          </BaseButton>
        </div>
      </form>

      <h3 class="set-lede profile-rule">Change your password</h3>
      <form class="profile-form" novalidate @submit.prevent="savePassword">
        <PasswordInput
          ref="currentField"
          v-model="current"
          label="Current password"
          autocomplete="current-password"
          :error="passwordErrors.current"
          :disabled="savingPassword"
        />
        <PasswordInput
          ref="nextField"
          v-model="next"
          label="New password"
          autocomplete="new-password"
          hint="At least 8 characters."
          :error="passwordErrors.next"
          :disabled="savingPassword"
        />
        <PasswordInput
          ref="confirmField"
          v-model="confirmation"
          label="Confirm new password"
          autocomplete="new-password"
          :error="passwordErrors.confirmation"
          :disabled="savingPassword"
        />
        <p v-if="passwordErrors.form" class="error-text selectable" role="alert">
          {{ passwordErrors.form }}
        </p>
        <p class="ok-text" aria-live="polite">{{ passwordNote }}</p>
        <div class="sheet-actions">
          <BaseButton type="submit" variant="primary" :disabled="savingPassword">
            {{ savingPassword ? 'Saving…' : 'Change password' }}
          </BaseButton>
        </div>
      </form>

      <h3 class="set-lede profile-rule">Signing out</h3>
      <p class="set-note">You’ll come back to the front page, and can log in again whenever.</p>
      <div class="sheet-actions">
        <BaseButton variant="ghost" @click="emit('logout')">Log out</BaseButton>
      </div>
    </template>
  </section>
</template>
