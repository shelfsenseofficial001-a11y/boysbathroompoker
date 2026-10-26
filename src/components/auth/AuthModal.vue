<script setup>
// Logging in and signing up, in one sheet.
//
// Two entry points use it. The buttons in the top bar open it closable, on
// whichever tab was asked for. The first-visit prompt opens it with the guest
// option showing and no way out but an answer - Escape and the backdrop
// resolve to "continue as guest", which is a choice rather than a dead end.
//
// There is no email field. A username is what an account is reached by, and
// useAuth maps it to a synthetic address for Supabase Auth, which has no
// other way to authenticate. A player never sees that address.
import { ref, computed, watch, nextTick } from 'vue';
import {
  useAuth,
  usernameAvailable,
  USERNAME_RE,
  INGAME_NAME_RE,
  MIN_PASSWORD,
} from '../../composables/useAuth.js';
import { clearInvalid } from '../../lib/invalid.js';
import BaseModal from '../ui/BaseModal.vue';
import BaseButton from '../ui/BaseButton.vue';
import TextField from '../ui/TextField.vue';
import PasswordInput from '../ui/PasswordInput.vue';
import SvgIcon from '../ui/SvgIcon.vue';

const props = defineProps({
  // Shows "Continue as guest". The first-visit prompt sets it; the top bar
  // doesn't, since whoever is already playing has an identity.
  showGuest: { type: Boolean, default: false },
  closable: { type: Boolean, default: true },
  initialTab: { type: String, default: 'login' },
});
const emit = defineEmits(['done', 'close']);

const auth = useAuth();

const tab = ref(props.initialTab === 'signup' ? 'signup' : 'login');
const username = ref('');
const ingameName = ref('');
const password = ref('');
const confirm = ref('');
const busy = ref(false);
const formError = ref('');
const sentTo = ref(''); // set if an account somehow lands on a confirmation
const fieldErrors = ref({});

const usernameField = ref(null);
const ingameField = ref(null);
const passwordField = ref(null);
const confirmField = ref(null);

const FIELDS = { username: usernameField, ingameName: ingameField, password: passwordField, confirm: confirmField };

// A password on screen was revealed for one moment of typing. Submitting, or
// moving to the other tab, ends that moment - the boxes stay where they are
// and the text in them would otherwise still be readable over the shoulder of
// whoever is sitting down next.
function hidePasswords() {
  passwordField.value?.hide();
  confirmField.value?.hide();
}

const isSignup = computed(() => tab.value === 'signup');
// A guest signing up keeps the id their seat hangs off, so this is an
// upgrade rather than a second account - and it is worth saying so.
const upgrading = computed(() => isSignup.value && auth.isGuest.value);

const title = computed(() => {
  if (sentTo.value) return 'Almost there';
  if (props.showGuest) return 'Before you sit down';
  return isSignup.value ? 'Create an account' : 'Welcome back';
});

const subtitle = computed(() => {
  if (sentTo.value) return 'This account needs confirming before it will let you in.';
  if (props.showGuest) return 'Play as a guest, or pick a username and keep it between visits.';
  if (upgrading.value) return 'Your name and your seat come with you.';
  return isSignup.value
    ? 'A username to log in with, and a name for the table.'
    : 'Log in to pick up where you left off.';
});

function validate() {
  const errors = {};
  const handle = username.value.trim();
  if (!handle) errors.username = 'Enter your username.';
  else if (isSignup.value && !USERNAME_RE.test(handle)) {
    errors.username = 'Use 3–20 letters, numbers or _ . - characters.';
  }

  if (isSignup.value) {
    const name = ingameName.value.trim();
    if (!name) errors.ingameName = 'Pick a name for the table.';
    else if (!INGAME_NAME_RE.test(name)) {
      errors.ingameName = 'Use up to 20 letters, numbers, spaces or _ . - characters.';
    }
  }

  if (!password.value) errors.password = 'Enter a password.';
  else if (isSignup.value && password.value.length < MIN_PASSWORD) {
    errors.password = `Use at least ${MIN_PASSWORD} characters.`;
  }

  // Checked here rather than at Supabase, which is never told about it: the
  // second box exists to catch a typo in the first, and only this page can
  // see both.
  if (isSignup.value) {
    if (!confirm.value) errors.confirm = 'Type the password again.';
    else if (confirm.value !== password.value) errors.confirm = 'These don’t match.';
  }

  return mark(errors);
}

// The first bad box is the one that gets the cursor.
function mark(errors) {
  fieldErrors.value = errors;
  const first = ['username', 'ingameName', 'password', 'confirm'].find((k) => errors[k]);
  if (first) FIELDS[first].value?.flag();
  return !first;
}

async function submit() {
  if (busy.value) return;
  formError.value = '';
  hidePasswords();
  if (!validate()) return;
  busy.value = true;
  try {
    if (isSignup.value) {
      const handle = username.value.trim();
      // Asked before signing up, so a taken name is a sentence under the box
      // it belongs to rather than an auth error about an address nobody saw.
      if (!(await usernameAvailable(handle))) {
        mark({ username: 'That username is taken.' });
        return;
      }
      const { needsConfirmation } = await auth.signUp({
        username: handle,
        ingameName: ingameName.value.trim(),
        password: password.value,
      });
      if (needsConfirmation) {
        sentTo.value = handle;
        return;
      }
    } else {
      await auth.signIn({ username: username.value.trim(), password: password.value });
    }
    emit('done');
  } catch (err) {
    // A clash that got past the check - two people signing up at once, or the
    // availability function missing - still belongs on the username box.
    if (/username is taken/i.test(err.message)) mark({ username: err.message });
    else formError.value = err.message;
    // Which box is wrong on a refused login is not something the server will
    // say - it deliberately won't confirm whether a username has an account -
    // so both are marked and the password takes the cursor.
    if (!isSignup.value) {
      usernameField.value?.flag();
      passwordField.value?.flag();
    }
  } finally {
    busy.value = false;
  }
}

async function continueAsGuest() {
  if (busy.value) return;
  formError.value = '';
  busy.value = true;
  try {
    await auth.continueAsGuest();
    emit('done');
  } catch (err) {
    formError.value = err.message;
  } finally {
    busy.value = false;
  }
}

// Swapping tabs clears what the other one complained about, but keeps what
// has been typed: a username entered on the wrong tab is still their username.
// The boxes have to be unmarked as well as unmessaged - username and password
// are on both tabs, so a border left red from a refused login would sit there
// over the sign-up form with nothing to explain it.
async function switchTo(next) {
  tab.value = next;
  formError.value = '';
  fieldErrors.value = {};
  for (const field of Object.values(FIELDS)) clearInvalid(field.value?.el);
  hidePasswords();
  await nextTick();
  usernameField.value?.el?.focus();
}

watch(
  () => props.initialTab,
  (next) => switchTo(next === 'signup' ? 'signup' : 'login')
);

// Escape or the backdrop on the first-visit prompt. There is nothing to
// close to, so it resolves to the choice most people want.
function onDismiss() {
  if (props.showGuest) return continueAsGuest();
  emit('close');
}
</script>

<template>
  <BaseModal
    :title="title"
    :subtitle="subtitle"
    :closable="closable"
    @close="emit('close')"
    @dismiss="onDismiss"
  >
    <!-- Email confirmation is on at the Supabase end, which usernames cannot
         satisfy - there is no inbox behind a synthetic address. Say what has
         happened rather than spinning. -->
    <div v-if="sentTo" class="auth-sent">
      <p class="help-text">
        <strong class="selectable">{{ sentTo }}</strong> was created, but this server is set to
        confirm accounts by email — and a username has no inbox to confirm from. Switch email
        confirmation off in Supabase, then log in. You can keep playing as a guest meanwhile.
      </p>
      <div class="sheet-actions">
        <BaseButton variant="primary" size="lg" @click="emit('done')">
          {{ auth.signedIn.value ? 'Back to the table' : 'Carry on' }}
        </BaseButton>
      </div>
    </div>

    <template v-else>
      <div class="auth-tabs" role="tablist">
        <button
          type="button"
          class="auth-tab"
          :class="{ 'is-on': !isSignup }"
          role="tab"
          :aria-selected="String(!isSignup)"
          @click="switchTo('login')"
        >
          Log in
        </button>
        <button
          type="button"
          class="auth-tab"
          :class="{ 'is-on': isSignup }"
          role="tab"
          :aria-selected="String(isSignup)"
          @click="switchTo('signup')"
        >
          Sign up
        </button>
      </div>

      <form class="auth-form" novalidate @submit.prevent="submit">
        <TextField
          ref="usernameField"
          v-model="username"
          label="Username"
          autocomplete="username"
          :maxlength="20"
          :placeholder="isSignup ? 'How you log in' : ''"
          :hint="isSignup ? 'Letters, numbers, _ . - — and yours alone.' : ''"
          :error="fieldErrors.username"
          :disabled="busy"
        />
        <TextField
          v-if="isSignup"
          ref="ingameField"
          v-model="ingameName"
          label="In-game name"
          autocomplete="nickname"
          :maxlength="20"
          placeholder="What everyone sees"
          hint="Shown at the table. Share it with whoever you like."
          :error="fieldErrors.ingameName"
          :disabled="busy"
        />
        <PasswordInput
          ref="passwordField"
          v-model="password"
          label="Password"
          :autocomplete="isSignup ? 'new-password' : 'current-password'"
          :hint="isSignup ? `At least ${MIN_PASSWORD} characters.` : ''"
          :error="fieldErrors.password"
          :disabled="busy"
        />
        <PasswordInput
          v-if="isSignup"
          ref="confirmField"
          v-model="confirm"
          label="Confirm password"
          autocomplete="new-password"
          :error="fieldErrors.confirm"
          :disabled="busy"
        />

        <p v-if="formError" class="error-text selectable" role="alert">{{ formError }}</p>

        <BaseButton type="submit" variant="primary" size="lg" :disabled="busy">
          {{ busy ? 'One moment…' : isSignup ? (upgrading ? 'Keep this player' : 'Create account') : 'Log in' }}
        </BaseButton>
      </form>

      <template v-if="showGuest">
        <div class="auth-or"><span>or</span></div>
        <BaseButton size="lg" :disabled="busy" @click="continueAsGuest">
          <SvgIcon name="eye" />Continue as guest
        </BaseButton>
        <p class="help-text auth-guest-note">
          A guest account is made for you. It lasts as long as this browser remembers it.
        </p>
      </template>

      <div v-else class="auth-switch">
        {{ isSignup ? 'Already have an account?' : 'New here?' }}
        <button type="button" class="link" @click="switchTo(isSignup ? 'login' : 'signup')">
          {{ isSignup ? 'Log in' : 'Create an account' }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>
