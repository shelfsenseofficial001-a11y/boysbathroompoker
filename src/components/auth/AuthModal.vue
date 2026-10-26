<script setup>
// Logging in and signing up, in one sheet.
//
// Two entry points use it. The buttons in the top bar open it closable, on
// whichever tab was asked for. The first-visit prompt opens it with the guest
// option showing and no way out but an answer - Escape and the backdrop
// resolve to "continue as guest", which is a choice rather than a dead end.
import { ref, computed, watch, nextTick } from 'vue';
import { useGuestAuth } from '../../composables/useGuestAuth.js';
import BaseModal from '../ui/BaseModal.vue';
import BaseButton from '../ui/BaseButton.vue';
import TextField from '../ui/TextField.vue';
import SvgIcon from '../ui/SvgIcon.vue';

const props = defineProps({
  // Shows "Continue as guest". The first-visit prompt sets it; the top bar
  // doesn't, since whoever is already playing has an identity.
  showGuest: { type: Boolean, default: false },
  closable: { type: Boolean, default: true },
  initialTab: { type: String, default: 'login' },
});
const emit = defineEmits(['done', 'close']);

const auth = useGuestAuth();

const tab = ref(props.initialTab === 'signup' ? 'signup' : 'login');
const email = ref('');
const password = ref('');
const username = ref('');
const busy = ref(false);
const formError = ref('');
const sentTo = ref(''); // set once a confirmation email is on its way
const fieldErrors = ref({});

const emailField = ref(null);
const passwordField = ref(null);
const usernameField = ref(null);

const isSignup = computed(() => tab.value === 'signup');
// A guest signing up keeps the id their chips hang off, so this is an
// upgrade rather than a second account - and it is worth saying so.
const upgrading = computed(() => isSignup.value && auth.isGuest.value);

const title = computed(() => {
  if (sentTo.value) return 'Check your email';
  if (props.showGuest) return 'Before you sit down';
  return isSignup.value ? 'Create an account' : 'Welcome back';
});

const subtitle = computed(() => {
  if (sentTo.value) return `We’ve sent a confirmation link to ${sentTo.value}.`;
  if (props.showGuest) return 'Play as a guest, or keep your chips between visits with an account.';
  if (upgrading.value) return 'Your chips and your seat come with you.';
  return isSignup.value ? 'Chips are play money — an account just keeps them.' : 'Log in to pick up where you left off.';
});

// Deliberately loose. The real check is whether the confirmation mail
// arrives; a clever pattern here only turns away people with unusual - and
// perfectly valid - addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Matches the check constraint on profiles.username, and the character set
// the table's own rename allows.
const USERNAME_RE = /^[\p{L}\p{N} _.'-]{3,20}$/u;

function validate() {
  const errors = {};
  const mail = email.value.trim();
  if (!mail) errors.email = 'Enter your email address.';
  else if (!EMAIL_RE.test(mail)) errors.email = 'That doesn’t look like an email address.';

  if (!password.value) errors.password = 'Enter a password.';
  else if (isSignup.value && password.value.length < 8) {
    errors.password = 'Use at least 8 characters.';
  }

  if (isSignup.value) {
    const name = username.value.trim();
    if (!name) errors.username = 'Pick a name for the table.';
    else if (!USERNAME_RE.test(name)) {
      errors.username = 'Use 3–20 letters, numbers, spaces or _ . - characters.';
    }
  }

  fieldErrors.value = errors;
  // The first bad box is the one that gets marked and the cursor.
  const first = ['email', 'password', 'username'].find((k) => errors[k]);
  if (first) {
    const field = { email: emailField, password: passwordField, username: usernameField }[first];
    field.value?.flag();
  }
  return !first;
}

async function submit() {
  if (busy.value) return;
  formError.value = '';
  if (!validate()) return;
  busy.value = true;
  try {
    if (isSignup.value) {
      const { needsConfirmation } = await auth.signUp({
        email: email.value.trim(),
        password: password.value,
        username: username.value.trim(),
      });
      if (needsConfirmation) {
        sentTo.value = email.value.trim();
        return;
      }
    } else {
      await auth.signIn({ email: email.value.trim(), password: password.value });
    }
    emit('done');
  } catch (err) {
    formError.value = err.message;
    // Which box is wrong is not something the server will say - it
    // deliberately won't confirm whether an email has an account - so on a
    // refused login both are marked and the password takes the cursor.
    if (!isSignup.value) {
      emailField.value?.flag();
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
// has been typed: an email entered on the wrong tab is still their email.
async function switchTo(next) {
  tab.value = next;
  formError.value = '';
  fieldErrors.value = {};
  await nextTick();
  emailField.value?.el?.focus();
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
    <!-- Sent, and nothing to do here until they follow the link. -->
    <div v-if="sentTo" class="auth-sent">
      <p class="help-text">
        Open it to finish setting up your account. You can keep playing in the meantime.
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
          ref="emailField"
          v-model="email"
          label="Email"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          :error="fieldErrors.email"
          :disabled="busy"
        />
        <TextField
          ref="passwordField"
          v-model="password"
          label="Password"
          type="password"
          :autocomplete="isSignup ? 'new-password' : 'current-password'"
          :hint="isSignup ? 'At least 8 characters.' : ''"
          :error="fieldErrors.password"
          :disabled="busy"
        />
        <TextField
          v-if="isSignup"
          ref="usernameField"
          v-model="username"
          label="Name at the table"
          autocomplete="nickname"
          :maxlength="20"
          placeholder="What everyone sees"
          :error="fieldErrors.username"
          :disabled="busy"
        />

        <p v-if="formError" class="error-text selectable" role="alert">{{ formError }}</p>

        <BaseButton type="submit" variant="primary" size="lg" :disabled="busy">
          {{ busy ? 'One moment…' : isSignup ? (upgrading ? 'Keep my chips' : 'Create account') : 'Log in' }}
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
