/**
 * Vite's `?raw` suffix, declared by hand.
 *
 * `packages/core/tsconfig.json` sets `"types": []`, so `vite/client` is not in scope —
 * and pulling it in would put DOM and Node globals back within reach of a package whose
 * whole point is not having them. One declaration is the smaller price. Tests read
 * fixtures this way because core cannot use `node:fs`.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
