<script setup lang="ts">
/**
 * StepperTimeline — 步进时间线
 * 显示工作流步骤的进度
 */
defineProps<{
  steps: Array<{ label: string; status: 'done' | 'active' | 'pending' }>
}>()
</script>

<template>
  <div class="stepper">
    <div
      v-for="(step, i) in steps"
      :key="i"
      class="stepper__step"
      :class="`stepper__step--${step.status}`"
    >
      <div class="stepper__node">
        <span v-if="step.status === 'done'" class="stepper__dot stepper__dot--done">●</span>
        <span v-else-if="step.status === 'active'" class="stepper__dot stepper__dot--active blink">◉</span>
        <span v-else class="stepper__dot stepper__dot--pending">○</span>
      </div>
      <span class="stepper__label">{{ step.label }}</span>
      <div class="stepper__line" v-if="i < steps.length - 1"></div>
    </div>
  </div>
</template>

<style scoped>
.stepper {
  display: flex;
  align-items: flex-start;
  gap: 0;
  padding: var(--space-4) 0;
  overflow-x: auto;
}
.stepper__step {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 80px;
  position: relative;
}
.stepper__node {
  font-size: var(--text-lg);
  line-height: 1;
  z-index: 2;
}
.stepper__dot--done   { color: var(--green); text-shadow: var(--glow-green); }
.stepper__dot--active { color: var(--cyan); text-shadow: var(--glow-cyan); }
.stepper__dot--pending { color: var(--text-3); }
.stepper__label {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-3);
  margin-top: var(--space-1);
  text-align: center;
  white-space: nowrap;
}
.stepper__step--done .stepper__label   { color: var(--green); }
.stepper__step--active .stepper__label { color: var(--cyan); }
.stepper__line {
  position: absolute;
  top: 10px;
  left: 50%;
  width: 100%;
  height: 1px;
  background: var(--border-2);
  z-index: 1;
}
.stepper__step--done .stepper__line {
  background: var(--green);
}
</style>
