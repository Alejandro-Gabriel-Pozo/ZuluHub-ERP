// Los CSS Modules devuelven un objeto de nombres de clase. Los tipos de Next ya lo declaran (se
// generan en `next-env.d.ts`, que no se versiona); esta referencia hace que `tsc` también los vea
// sin haber compilado antes, y no duplica la declaración.
/// <reference types="next" />

// Las pruebas leen `tokens.css` como texto (`import css from "./tokens.css?raw"`).
declare module "*.css?raw" {
  const texto: string;
  export default texto;
}
