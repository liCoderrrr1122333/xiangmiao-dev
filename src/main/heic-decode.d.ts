declare module 'heic-decode' {
  interface DecodeInput {
    buffer: Uint8Array | ArrayBuffer;
  }

  interface DecodedImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }

  export default function decode(input: DecodeInput): Promise<DecodedImage>;
}

