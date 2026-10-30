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
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useAuth } from '../../composables/useAuth.js';
import { emitAck } from '../../lib/socket.js';
import {
  checkIngameName,
  checkPasswordChange,
  profileChanges,
  normalizeIngameName,
} from '../../lib/accountRules.mjs';
import { checkBio, normalizeBio, bioRemaining, BIO_MAX, initialsFrom } from '../../../shared/profileFields.mjs';
import { uploadAvatar, removeAvatar, squareWebp } from '../../lib/avatar.js';
import { forgetAvatar } from '../../lib/avatars.js';
import { avatarSVG } from '../../lib/svg/avatars.js';
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

// The picture and the sentence. A third form, kept apart from the other two
// for the reason the first two are apart: a bio you are halfway through
// should not be able to stop a password change, and a refused upload should
// not swallow a bio that was fine.
const bio = ref('');
const savingLook = ref(false);
const lookError = ref('');
const lookNote = ref('');
// What the picture will be once saved. A local object URL while a file is
// chosen and not yet uploaded, so the preview shows the square that is
// actually going up rather than the original photo.
const previewUrl = ref('');
const previewFile = ref(null);
const fileInput = ref(null);

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
  bio: auth.profile.value?.bio || '',
  avatarUrl: auth.profile.value?.avatar_url || '',
}));

// What the circle shows right now: the file being considered, else the saved
// picture, else initials, else the generated mark every player has had all
// along. Four steps because each one can be absent.
const shownAvatar = computed(() => previewUrl.value || saved.value.avatarUrl || '');
const initials = computed(() => initialsFrom(ingameName.value || saved.value.username));
const bioLeft = computed(() => bioRemaining(bio.value));
const bioChanged = computed(() => normalizeBio(bio.value) !== normalizeBio(saved.value.bio));
const canSaveLook = computed(() => (bioChanged.value || !!previewFile.value) && !savingLook.value);

// Filled from the profile as it arrives, and again whenever a save moves it.
watch(
  saved,
  (now) => {
    username.value = now.username;
    ingameName.value = now.ingameName;
    // Only when nothing is being typed: a profile refreshed in the
    // background should not overwrite a sentence halfway through.
    if (!bioChanged.value) bio.value = now.bio;
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

// A file chosen. Nothing is uploaded yet: it is checked, squared and shown,
// so the player sees exactly what is about to go up and can change their
// mind without anything having left the machine.
async function pickFile(event) {
  const file = event.target.files?.[0];
  event.target.value = ''; // so choosing the same file twice still fires
  if (!file) return;
  lookError.value = '';
  lookNote.value = '';
  try {
    const blob = await squareWebp(file);
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = URL.createObjectURL(blob);
    previewFile.value = file;
  } catch (err) {
    lookError.value = err.message;
  }
}

function clearPick() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
  previewFile.value = null;
}

// Removing the picture, as opposed to replacing it. Saved immediately rather
// than on the form's button: "remove" is the whole of the instruction, and a
// Save sitting under it would leave the circle looking cleared when it is
// not.
async function dropAvatar() {
  if (savingLook.value) return;
  savingLook.value = true;
  lookError.value = '';
  try {
    clearPick();
    await auth.saveProfileExtras({ avatar_url: null });
    await removeAvatar(auth.userId.value);
    // As in saveLook: the table has to be told to ask again, or it keeps
    // drawing the picture that has just been taken down.
    forgetAvatar(saved.value.username);
    lookNote.value = 'Picture removed.';
  } catch (err) {
    lookError.value = err.message;
  } finally {
    savingLook.value = false;
  }
}

async function saveLook() {
  if (!canSaveLook.value) return;
  lookError.value = '';
  lookNote.value = '';

  const badBio = checkBio(bio.value);
  if (badBio) {
    lookError.value = badBio;
    return;
  }

  savingLook.value = true;
  try {
    const patch = {};
    // The upload first. If it fails there is nothing to undo; if the row
    // write failed after an upload, the file would be in the bucket with
    // nothing pointing at it, which the next upload overwrites anyway.
    if (previewFile.value) patch.avatar_url = await uploadAvatar(auth.userId.value, previewFile.value);
    if (bioChanged.value) patch.bio = normalizeBio(bio.value);
    await auth.saveProfileExtras(patch);
    // The table caches faces by handle and asks once, so a picture changed
    // while sitting at one would not show until the page was reloaded.
    // Forgetting it here is what makes the new one appear on the nameplate
    // without leaving the seat.
    if (patch.avatar_url) forgetAvatar(saved.value.username);
    clearPick();
    lookNote.value = 'Saved.';
  } catch (err) {
    lookError.value = err.message;
  } finally {
    savingLook.value = false;
  }
}

onBeforeUnmount(clearPick);

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

      <h3 class="set-lede profile-rule">Your picture and bio</h3>
      <p class="set-note">
        Both are shown on your profile page, which anyone with the link can read.
      </p>

      <form class="profile-form" novalidate @submit.prevent="saveLook">
        <div class="avatar-row">
          <span class="avatar-preview">
            <img v-if="shownAvatar" :src="shownAvatar" alt="Your picture, as it will appear" />
            <span v-else-if="initials" class="avatar-initials" aria-hidden="true">{{ initials }}</span>
            <span v-else class="contents" v-html="avatarSVG(saved.username)" />
          </span>
          <div class="avatar-acts">
            <!-- A plain file input, driven by the button beside it: the
                 native control cannot be styled to match anything else on
                 this page, and hiding it loses nothing - the button is a
                 real button and carries the label. -->
            <input
              ref="fileInput"
              type="file"
              class="sr-only"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Choose a picture"
              @change="pickFile"
            />
            <BaseButton size="sm" :disabled="savingLook" @click="fileInput?.click()">
              {{ shownAvatar ? 'Change picture' : 'Choose picture' }}
            </BaseButton>
            <BaseButton
              v-if="previewFile || saved.avatarUrl"
              size="sm"
              variant="ghost"
              :disabled="savingLook"
              @click="previewFile ? clearPick() : dropAvatar()"
            >
              {{ previewFile ? 'Undo' : 'Remove' }}
            </BaseButton>
            <p class="avatar-hint">PNG, JPEG or WebP, up to 2 MB. Cropped to a square.</p>
          </div>
        </div>

        <div class="field">
          <label for="profile-bio">Bio</label>
          <textarea
            id="profile-bio"
            v-model="bio"
            class="input bio-input"
            rows="3"
            :maxlength="BIO_MAX + 40"
            :disabled="savingLook"
            placeholder="A line about how you play."
          />
          <!-- Counts down rather than up, and turns when it goes under:
               "12 left" is the number being watched, not "148 of 160".
               The maxlength is deliberately looser than the limit, so a
               paste that is slightly too long can be edited down rather
               than silently truncated mid-word. -->
          <p class="help-text bio-count" :class="{ 'is-over': bioLeft < 0 }" aria-live="polite">
            {{ bioLeft }} left
          </p>
        </div>

        <p v-if="lookError" class="error-text selectable" role="alert">{{ lookError }}</p>
        <p class="ok-text" aria-live="polite">{{ lookNote }}</p>
        <div class="sheet-actions">
          <BaseButton type="submit" variant="primary" :disabled="!canSaveLook">
            {{ savingLook ? 'Saving…' : 'Save' }}
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
