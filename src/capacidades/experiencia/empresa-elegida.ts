/**
 * Qué hace la web cuando una persona con sesión entra: ¿a cuál empresa? (armazón web §3.2 paso 9, §1.1
 * «Elegir empresa»). Decide solo con dos datos que ya resolvió el servidor: las empresas de la persona EN LA
 * MARCA DEL HOST y el valor de la cookie `zh_empresa` de este host. Previene: entrar a una empresa que la
 * persona no tiene en esta marca (la cookie la puede inventar el navegador: se valida siempre contra la
 * lista) y elegir de más cuando hay una sola. Chequeo: `empresa-elegida.test.ts` y las pruebas de aislamiento
 * entre marcas de `test/integracion/web-*.test.ts`.
 *
 *  - cookie con un valor que NO está entre las empresas de la persona en esta marca → `SIN_PERMISO` (aunque la
 *    persona no tenga ninguna: forzar la cookie de otra marca nunca se confunde con «no tenés empresas»);
 *  - cookie válida → entra a esa;
 *  - sin cookie: ninguna empresa → `SIN_EMPRESAS`; una sola → entra directo; varias → `ELEGIR`.
 */
export type DecisionDeEmpresa<T extends Readonly<{ empresaId: string }>> =
  | Readonly<{ tipo: "ENTRA"; empresa: T }>
  | Readonly<{ tipo: "ELEGIR"; empresas: readonly T[] }>
  | Readonly<{ tipo: "SIN_EMPRESAS" }>
  | Readonly<{ tipo: "SIN_PERMISO" }>;

export function decidirEmpresa<T extends Readonly<{ empresaId: string }>>(
  empresas: readonly T[],
  cookieDeEmpresa: string | null | undefined,
): DecisionDeEmpresa<T> {
  if (cookieDeEmpresa !== undefined && cookieDeEmpresa !== null && cookieDeEmpresa !== "") {
    const elegida = empresas.find((empresa) => empresa.empresaId === cookieDeEmpresa);
    return elegida === undefined ? { tipo: "SIN_PERMISO" } : { tipo: "ENTRA", empresa: elegida };
  }
  const [unica, ...resto] = empresas;
  if (unica === undefined) return { tipo: "SIN_EMPRESAS" };
  return resto.length === 0 ? { tipo: "ENTRA", empresa: unica } : { tipo: "ELEGIR", empresas };
}
