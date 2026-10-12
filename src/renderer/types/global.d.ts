import type { ElectronApi } from '../../shared/types';

declare global {
  interface Window {
    xiangmao?: ElectronApi;
  }
}

export {};
