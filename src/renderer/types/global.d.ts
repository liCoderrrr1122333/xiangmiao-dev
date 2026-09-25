import type { ElectronApi } from '../../shared/types';

declare global {
  interface Window {
    masklock?: ElectronApi;
  }
}

export {};
