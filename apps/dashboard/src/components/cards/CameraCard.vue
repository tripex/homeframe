<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { CameraOff, Video } from "lucide-vue-next";
import GlassCard from "./GlassCard.vue";
import { useI18n } from "../../i18n";

const props = defineProps<{
  title: string;
  /** Snapshot URL served by Homeframe Runtime; undefined when nothing is bound. */
  src?: string;
  refreshSeconds?: number;
}>();

const { t } = useI18n();
const shown = ref<string>();
const unavailable = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

/**
 * Load the next still off-screen and swap it in only once it has arrived,
 * so a slow camera never flashes an empty frame. Stills, not a stream: a wall
 * tablet showing three cameras should not hold three video connections open.
 */
function refresh(): void {
  if (!props.src || document.hidden) return;
  const next = `${props.src}${props.src.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const image = new Image();
  image.onload = () => {
    shown.value = next;
    unavailable.value = false;
  };
  image.onerror = () => {
    unavailable.value = true;
  };
  image.src = next;
}

function restart(): void {
  if (timer) clearInterval(timer);
  shown.value = undefined;
  refresh();
  timer = setInterval(refresh, Math.max(5, props.refreshSeconds ?? 10) * 1000);
}

onMounted(restart);
watch(() => [props.src, props.refreshSeconds], restart);
onUnmounted(() => timer && clearInterval(timer));
</script>

<template>
  <GlassCard className="camera-card">
    <img v-if="shown" class="camera-still" :src="shown" :alt="title" />
    <div v-else class="camera-placeholder">
      <CameraOff v-if="!src || unavailable" :size="22" />
      <span>{{ !src ? t("cameraCard.empty") : unavailable ? t("cameraCard.unavailable") : "" }}</span>
    </div>

    <div class="camera-label">
      <Video :size="13" />
      <span>{{ title }}</span>
      <span v-if="shown && unavailable" class="camera-stale">{{ t("cameraCard.unavailable") }}</span>
    </div>
  </GlassCard>
</template>
