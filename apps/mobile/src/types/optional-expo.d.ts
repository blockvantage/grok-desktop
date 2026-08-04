/** Optional Expo modules — may be absent in Node tests / slim installs. */
declare module "expo-local-authentication" {
  export function hasHardwareAsync(): Promise<boolean>;
  export function isEnrolledAsync(): Promise<boolean>;
  export function authenticateAsync(options?: {
    promptMessage?: string;
    cancelLabel?: string;
    disableDeviceFallback?: boolean;
  }): Promise<{ success: boolean }>;
}

declare module "expo-keep-awake" {
  export function activateKeepAwakeAsync(tag?: string): Promise<void>;
  export function activateKeepAwake(tag?: string): void;
  export function deactivateKeepAwake(tag?: string): Promise<void> | void;
}
