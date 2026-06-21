<script setup lang="ts">
</script>

<template>
  <div class="chronos-carousel">
    <div class="carousel-container">
      <div class="carousel-track">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chronos-carousel {
  width: 100%;
}

.carousel-container {
  width: 100%;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.carousel-container::-webkit-scrollbar {
  display: none;
}

.carousel-track {
  display: flex;
  gap: 1rem;
  padding: 0.5rem;
}

.carousel-track :deep(.tracker-card) {
  flex: 0 0 85vw;
  scroll-snap-align: center;
  scroll-snap-stop: always;
}

@media (min-width: 769px) {
  .chronos-carousel {
    display: none;
  }
}
</style>
