import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';

// jsdom lacks these browser APIs; provide minimal shims for unit tests.
if (typeof globalThis.URL.createObjectURL !== 'function') {
  let n = 0;
  const map = new Map<string, unknown>();
  globalThis.URL.createObjectURL = ((obj: unknown) => {
    const url = `blob:mock/${++n}`;
    map.set(url, obj);
    return url;
  }) as typeof URL.createObjectURL;
  globalThis.URL.revokeObjectURL = ((url: string) => {
    map.delete(url);
  }) as typeof URL.revokeObjectURL;
}
