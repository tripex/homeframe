<script setup lang="ts">
/**
 * A quiet line drawing of a washer, dryer or dishwasher in the colours of the
 * drawn house (HomeSceneCard). It only moves while the machine runs: the drum
 * turns (faster when spinning) with a little water in a washer, and a soft
 * spray rises behind a dishwasher's door. prefers-reduced-motion stops it.
 */
defineProps<{
  kind: "washer" | "dryer" | "dishwasher";
  state: "running" | "paused" | "finished" | "error" | "idle" | "off" | "unavailable";
  phase?: string;
}>();
</script>

<template>
  <svg
    class="appliance-art"
    :class="[`appliance-art-${kind}`, `is-${state}`, phase ? `phase-${phase}` : undefined]"
    viewBox="0 0 64 64"
    aria-hidden="true"
  >
    <defs>
      <clipPath :id="`drum-${kind}`">
        <circle cx="32" cy="38" r="11.5" />
      </clipPath>
    </defs>

    <rect class="art-body" x="9" y="4" width="46" height="56" rx="7" />
    <line class="art-seam" x1="9" y1="15" x2="55" y2="15" />
    <rect class="art-display" x="14" y="8" width="14" height="3.5" rx="1.5" />
    <circle class="art-knob" cx="47" cy="9.8" r="2.4" />

    <template v-if="kind === 'dishwasher'">
      <rect class="art-handle" x="22" y="19" width="20" height="2.6" rx="1.3" />
      <rect class="art-door" x="13" y="24" width="38" height="32" rx="3" />
      <g class="art-spray">
        <circle cx="24" cy="48" r="1.4" />
        <circle cx="32" cy="50" r="1.4" />
        <circle cx="40" cy="48" r="1.4" />
        <circle cx="28" cy="44" r="1.1" />
        <circle cx="36" cy="44" r="1.1" />
      </g>
      <path class="art-check" d="M26 40 l4 4 l8 -8" />
    </template>

    <template v-else>
      <circle class="art-door-ring" cx="32" cy="38" r="15" />
      <circle class="art-glass" cx="32" cy="38" r="11.5" />
      <g :clip-path="`url(#drum-${kind})`">
        <path v-if="kind === 'washer'" class="art-water" d="M8 42 q6 -3 12 0 t12 0 t12 0 t12 0 t12 0 V52 H8 Z" />
        <g class="art-drum">
          <path class="art-laundry" d="M24 41 q4 -6 9 -2 q4 3 7 -1 q1 5 -5 7 q-6 2 -11 -4 Z" />
          <circle class="art-lifter" cx="32" cy="28.5" r="1.3" />
          <circle class="art-lifter" cx="40.2" cy="42.8" r="1.3" />
          <circle class="art-lifter" cx="23.8" cy="42.8" r="1.3" />
        </g>
      </g>
      <path class="art-check" d="M27 38 l3.5 3.5 l7 -7" />
    </template>
  </svg>
</template>
