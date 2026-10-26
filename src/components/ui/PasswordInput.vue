<script setup>
// A password field that can be read back.
//
// Typing a password you cannot see into a box twice is how a confirmation
// mismatch happens in the first place, so each field can show its own - the
// login password, the sign-up password and its confirmation are three
// separate decisions, and revealing one says nothing about the others.
//
// Everything else matches TextField, which this would otherwise be: the same
// label, hint, `is-invalid` mark and `flag()` the rest of the forms use.
import { computed, ref, useId } from 'vue';
import { flagInvalid } from '../../lib/invalid.js';
import SvgIcon from './SvgIcon.vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
  autocomplete: { type: String, default: 'current-password' },
  placeholder: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const input = ref(null);
const shown = ref(false);
const uid = useId();
const fieldId = computed(() => `f-${uid}`);
const errorId = computed(() => `e-${uid}`);

// The label says what the button will do, not what the field is doing. A
// hidden password offers "Show password"; a visible one offers to hide it.
const toggleLabel = computed(() => (shown.value ? 'Hide password' : 'Show password'));

// Toggling moves focus to the button, and a password half-typed should be
// carried on with - so the cursor goes back where it was, at the end.
function toggle() {
  shown.value = !shown.value;
  const el = input.value;
  if (!el) return;
  const at = el.value.length;
  requestAnimationFrame(() => {
    try {
      el.setSelectionRange(at, at);
    } catch {
      // A field that won't hand over its selection; the value is unchanged
      // either way, which is all that actually matters here.
    }
  });
}

// Called by the form when this is the box that was wrong, and by it again
// when the form is submitted or the tab changes: a password left on screen
// outlives the moment it was wanted for.
function flag() {
  flagInvalid(input.value, { focus: true });
}

function hide() {
  shown.value = false;
}

defineExpose({ flag, hide, el: input });
</script>

<template>
  <div class="field">
    <label :for="fieldId">{{ label }}</label>
    <div class="field-password">
      <input
        :id="fieldId"
        ref="input"
        class="input"
        :type="shown ? 'text' : 'password'"
        :value="modelValue"
        :autocomplete="autocomplete"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? errorId : undefined"
        @input="emit('update:modelValue', $event.target.value)"
      />
      <!-- type="button" and nothing else: inside a form, a bare button is a
           submit button, and revealing a password would send the form. -->
      <button
        type="button"
        class="password-toggle"
        :aria-label="toggleLabel"
        :aria-pressed="String(shown)"
        :title="toggleLabel"
        :disabled="disabled"
        @click="toggle"
      >
        <SvgIcon :name="shown ? 'eye-off' : 'eye'" />
      </button>
    </div>
    <p v-if="error" :id="errorId" class="field-error selectable" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="help-text">{{ hint }}</p>
  </div>
</template>
