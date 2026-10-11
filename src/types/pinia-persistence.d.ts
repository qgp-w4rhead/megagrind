import 'pinia'

declare module 'pinia' {
  export interface PiniaCustomProperties {
    $persist: () => void
    $hydrate: () => void
    __persistenceRetry?: () => void
  }
}
