// Short capability-checked chime for progress-check prompts. Never throws —
// callers get a boolean so they can surface honest capability feedback.
export function audioSupported(): boolean {
  try {
    const Ctx = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    return typeof Ctx === 'function'
  } catch {
    return false
  }
}

export function playChime(): boolean {
  try {
    const Ctx = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return false
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.55)
    osc.onended = () => void ctx.close().catch(() => {})
    return true
  } catch {
    return false
  }
}
