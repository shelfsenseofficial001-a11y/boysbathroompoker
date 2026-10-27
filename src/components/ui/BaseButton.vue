<script setup>
// Every button on a form or a page screen.
//
// The look lives in styles.css under .btn and its variants, which the table's
// own renderer writes by hand too - so this component composes those classes
// rather than restating the design in utilities. One place to reach for when
// a button needs to change everywhere, without the stylesheet and the
// components disagreeing about what a button is.
//
// The felt's action buttons (.act), the chip tray (.chip-btn) and the pot
// shortcuts (.quick-btn) are not these: they are part of the renderer's own
// layout and sizing.
import { computed, useAttrs } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps({
  // Matches the stylesheet: .btn, .btn-primary, .btn-ghost.
  variant: {
    type: String,
    default: 'default',
    // `danger` is the one that takes something away - signing out, leaving a
    // seat. It already exists as .btn-danger for the table's own confirm
    // sheets; this lets a component ask for it by name rather than by class.
    validator: (v) => ['default', 'primary', 'ghost', 'danger'].includes(v),
  },
  // .btn-sm (34px), the default (42px), .btn-lg (52px, full width).
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v),
  },
  // A square button holding nothing but an icon.
  icon: { type: Boolean, default: false },
  type: { type: String, default: 'button' },
});

const attrs = useAttrs();

const classes = computed(() => [
  'btn',
  props.variant !== 'default' && `btn-${props.variant}`,
  props.size !== 'md' && `btn-${props.size}`,
  props.icon && 'btn-icon',
]);
</script>

<template>
  <button :type="type" :class="classes" v-bind="attrs">
    <slot />
  </button>
</template>
