<script setup>
// A whole-number field with its own - / + buttons. The browser's native
// spinners are hidden (they're tiny and ugly), so every number on a form
// goes through this.
//
// The input is deliberately left uncontrolled - no :value binding. These
// fields are text inputs that wear their grouping as they are typed (a
// number input will not hold "23,567" at all), and the caret-preserving
// regrouping in src/lib/invalid.js writes straight to the element. Binding
// the value as well would mean Vue and that guard taking turns to overwrite
// each other mid-keystroke. So: the element owns the text, this component
// owns the number, and `set` is how a parent writes one in.
import { ref, onMounted, watch } from 'vue';
import { setNumberValue, stripGrouping, flagInvalid, numberBounds, readNumber } from '../../lib/invalid.js';
import SvgIcon from './SvgIcon.vue';

const props = defineProps({
  modelValue: { type: Number, default: null },
  min: { type: Number, default: 1 },
  max: { type: Number, default: null },
  step: { type: Number, default: 1 },
  label: { type: String, required: true },
  id: { type: String, default: '' },
  wide: { type: Boolean, default: true },
});
const emit = defineEmits(['update:modelValue', 'change']);

const input = ref(null);

const parse = (text) => {
  const raw = stripGrouping(text).trim();
  return raw !== '' && /^-?\d+$/.test(raw) ? Number(raw) : null;
};

function onInput(event) {
  emit('update:modelValue', parse(event.target.value));
}

// A parent writing a figure in - the blinds following the starting stack,
// say. Goes through setNumberValue so the grouping lands with it.
function set(value) {
  setNumberValue(input.value, value);
  emit('update:modelValue', parse(input.value.value));
}

// The field stepping itself. Snaps onto the step grid first, so 37 with a
// step of 10 goes to 40 rather than 47, and a field left unreadable steps
// from its own floor rather than from zero.
function stepBy(dir) {
  const el = input.value;
  if (!el || el.disabled) return;
  const { min, max } = numberBounds(el);
  const step = props.step || 1;
  const current = readNumber(el) ?? Math.max(0, min === -Infinity ? 0 : min);
  const snapped = dir > 0 ? Math.floor(current / step) * step : Math.ceil(current / step) * step;
  const next = Math.min(max, Math.max(min, snapped + dir * step));
  if (next === current) return;
  set(next);
  emit('change', next);
}

// What a rejected value looks like on the field itself: red border and a
// short shake, so the message and the field agree about which box is wrong.
function flag() {
  flagInvalid(input.value, { focus: true });
}

onMounted(() => setNumberValue(input.value, props.modelValue ?? ''));

// An outside change that didn't come from typing in this field.
watch(
  () => props.modelValue,
  (value) => {
    if (!input.value || value === parse(input.value.value)) return;
    setNumberValue(input.value, value ?? '');
  }
);

defineExpose({ set, flag, el: input });
</script>

<template>
  <div class="stepper" :class="{ 'is-wide': wide }">
    <button
      type="button"
      class="step-btn"
      tabindex="-1"
      :aria-label="`Decrease ${label}`"
      @click="stepBy(-1)"
    >
      <SvgIcon name="minus" />
    </button>
    <input
      ref="input"
      class="input num"
      type="text"
      data-numeric
      :id="id || undefined"
      :min="min"
      :max="max === null ? undefined : max"
      :step="step"
      inputmode="numeric"
      autocomplete="off"
      :aria-label="label"
      @input="onInput"
      @change="emit('change', parse($event.target.value))"
    />
    <button
      type="button"
      class="step-btn"
      tabindex="-1"
      :aria-label="`Increase ${label}`"
      @click="stepBy(1)"
    >
      <SvgIcon name="plus" />
    </button>
  </div>
</template>
