<script setup lang="ts">
import { X } from "lucide-vue-next";
import { ref } from "vue";
import type { HomeAssistantStatus } from "../../composables/useHomeAssistant";

const props = defineProps<{
  status: HomeAssistantStatus;
  error?: string;
}>();

const emit = defineEmits<{
  close: [];
  connect: [baseUrl: string, token: string];
}>();

const baseUrl = ref(
  sessionStorage.getItem("homeframe.haUrl") ||
    import.meta.env.VITE_HA_URL ||
    "http://homeassistant.local:8123",
);

const token = ref(import.meta.env.VITE_HA_TOKEN || "");

function connect(): void {
  sessionStorage.setItem("homeframe.haUrl", baseUrl.value);
  emit("connect", baseUrl.value, token.value);
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="connect-modal" role="dialog" aria-modal="true">
      <button
        class="icon-button close-button"
        type="button"
        aria-label="Close"
        @click="emit('close')"
      >
        <X :size="18" />
      </button>

      <span class="eyebrow">HOME ASSISTANT</span>
      <h2>Connect your home</h2>
      <p>
        Homeframe reads area, device and entity registries over Home Assistant's
        WebSocket API. The token is kept in memory and is never written to the
        repository.
      </p>

      <label>
        Home Assistant URL
        <input v-model="baseUrl" placeholder="http://homeassistant.local:8123" />
      </label>

      <label>
        Long-lived access token
        <textarea
          v-model="token"
          rows="4"
          placeholder="Paste token…"
        />
      </label>

      <p v-if="props.error" class="connect-error">{{ props.error }}</p>

      <button
        class="primary-button"
        type="button"
        :disabled="status === 'connecting' || !baseUrl || !token"
        @click="connect"
      >
        {{ status === "connecting" ? "Connecting…" : "Connect & discover" }}
      </button>

      <small>
        Direct long-lived-token authentication is for local development. A
        production authentication strategy will be added before release.
      </small>
    </section>
  </div>
</template>
