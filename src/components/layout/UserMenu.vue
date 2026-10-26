<script setup>
// Everything about you, under your avatar: change your name, and whatever
// else the screen has to offer. `groups` is a list of lists - each inner list
// is a block of items with a rule drawn between blocks, so related things sit
// together. An item is { id, icon, label, danger?, mobileOnly? }.
//
// `mobileOnly` is for an offer the top bar makes as a button when it has the
// width and cannot below 640px. The item is always rendered and hidden by CSS
// above that width, so the menu a mouse sees is unchanged.
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useAuth } from '../../composables/useAuth.js';
import { avatarSVG } from '../../lib/svg/avatars.js';
import { emitAck } from '../../lib/socket.js';
import SvgIcon from '../ui/SvgIcon.vue';

const props = defineProps({
  user: { type: Object, required: true },
  groups: { type: Array, default: () => [] },
});
const emit = defineEmits(['pick', 'renamed']);

const open = ref(false);
const editing = ref(false);
const draft = ref('');
const saving = ref(false);
const error = ref('');
const wrap = ref(null);
const pill = ref(null);
const nameInput = ref(null);

const auth = useAuth();

// "Change name" is here for a guest and nowhere else.
//
// A guest has no profile and no page of their own, so the menu is the only
// place they can be named at all. An account has Settings > Profile, where
// the in-game name sits beside the username it is easily confused with - and
// a second way in, offering only half of that, is how the two drift apart.
const blocks = computed(() => {
  const rename = auth.hasAccount.value
    ? []
    : [[{ id: 'rename', icon: 'pencil', label: 'Change name' }]];
  return [...rename, ...props.groups];
});

const avatar = computed(() => avatarSVG(props.user.username));

const close = () => {
  open.value = false;
};

async function startEditing() {
  close();
  error.value = '';
  draft.value = props.user.username;
  editing.value = true;
  await nextTick();
  nameInput.value?.focus();
  nameInput.value?.select();
}

function pick(id) {
  if (id === 'rename') return startEditing();
  close();
  emit('pick', id);
}

async function save() {
  if (saving.value) return;
  const value = draft.value.trim();
  if (!value || value === props.user.username) {
    editing.value = false;
    return;
  }
  saving.value = true;
  try {
    const res = await emitAck('setName', { name: value });
    // The avatar is drawn from the name too, so the whole pill is redrawn
    // rather than the one label patched.
    props.user.username = res.name;
    editing.value = false;
    emit('renamed', res.name);
  } catch (err) {
    error.value = err.message;
    nameInput.value?.focus();
  } finally {
    saving.value = false;
  }
}

function cancelEditing() {
  editing.value = false;
  error.value = '';
}

// Anywhere else, or Escape, puts it away.
function onDocumentClick(e) {
  if (open.value && !wrap.value?.contains(e.target)) close();
}
function onKeydown(e) {
  if (e.key !== 'Escape') return;
  if (editing.value) return cancelEditing();
  if (open.value) {
    close();
    pill.value?.focus();
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div ref="wrap" class="user-menu">
    <span v-if="editing" class="name-edit" :data-error="error || undefined">
      <input
        ref="nameInput"
        v-model="draft"
        class="input input-sm"
        maxlength="20"
        aria-label="Your name"
        :disabled="saving"
        @keydown.enter.prevent="save"
        @keydown.esc.prevent="cancelEditing"
        @blur="save"
      />
    </span>
    <template v-else>
      <button
        ref="pill"
        class="user-pill"
        aria-haspopup="menu"
        :aria-expanded="String(open)"
        title="Your account"
        @click.stop="open = !open"
      >
        <span class="contents" v-html="avatar" />
        <span class="user-name">{{ user.username }}</span>
        <SvgIcon name="chevronDown" />
      </button>
      <div class="umenu" role="menu" aria-label="Your account" :hidden="!open">
        <!-- Who this menu belongs to. The pill shows the name beside the
             avatar when there is room for it; under 900px there isn't, and
             this is where it goes instead. -->
        <p class="umenu-head only-sm">{{ user.username }}</p>
        <div v-for="(group, i) in blocks" :key="i" class="umenu-group">
          <button
            v-for="item in group"
            :key="item.id"
            type="button"
            role="menuitem"
            class="umenu-item"
            :class="{ 'is-danger': item.danger, 'only-sm': item.mobileOnly }"
            @click="pick(item.id)"
          >
            <SvgIcon v-if="item.icon" :name="item.icon" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
