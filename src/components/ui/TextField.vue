<script setup>
// A labelled text input with its complaint attached to it.
//
// Errors used to be said only at the foot of a panel, which left the player
// reading a message with no idea which of three boxes it was about. A
// rejected value marks its own field here - the same `is-invalid` the rest
// of the game uses, red border and a short shake - and says why underneath.
import { computed, ref, useId } from 'vue';
import { flagInvalid } from '../../lib/invalid.js';

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
  type: { type: String, default: 'text' },
  autocomplete: { type: String, default: 'off' },
  placeholder: { type: String, default: '' },
  maxlength: { type: Number, default: null },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const input = ref(null);
const uid = useId();
const fieldId = computed(() => `f-${uid}`);
const errorId = computed(() => `e-${uid}`);

// Called by the form when this is the box that was wrong: marks it, shakes
// it and puts the cursor in it.
function flag() {
  flagInvalid(input.value, { focus: true });
}

defineExpose({ flag, el: input });
</script>

<template>
  <div class="field">
    <label :for="fieldId">{{ label }}</label>
    <input
      :id="fieldId"
      ref="input"
      class="input"
      :type="type"
      :value="modelValue"
      :autocomplete="autocomplete"
      :placeholder="placeholder"
      :maxlength="maxlength ?? undefined"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
      @input="emit('update:modelValue', $event.target.value)"
    />
    <p v-if="error" :id="errorId" class="field-error selectable" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="help-text">{{ hint }}</p>
  </div>
</template>
