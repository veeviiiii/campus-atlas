// `npm test` runs the site's TypeScript helpers directly in Node (Node strips the types itself). The
// app's imports leave out ".ts" (the bundler finds it); this hook adds it, so nothing extra is needed.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.{1,2}\//.test(specifier) && !/\.(m?[jt]s|json)$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        // not a .ts file: resolve it as written
      }
    }
    return next(specifier, context);
  },
});
