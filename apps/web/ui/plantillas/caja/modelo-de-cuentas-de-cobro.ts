import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { RUTAS_DE_CAJA, estadoDeLista, type FilaDeLista } from "./lista-de-caja";

/**
 * El modelo de vista de «Cuentas de cobro» (maqueta aprobada `medios.html`, 09/11/2026): de lo que entrega la lista de la composición y las sucursales que la persona puede elegir, lo que
 * se ve en cada tarjeta y las opciones del formulario. Puro: sin React ni servidor. Los textos salen del catálogo (`caja.*`, con su fuente en `catalogo-caja.ts`).
 */

export const RUTAS_DE_CUENTAS = {
  lista: RUTAS_DE_CAJA.cuentas,
  nuevo: `${RUTAS_DE_CAJA.cuentas}/nuevo`,
} as const;

export const rutaDeUnaCuenta = (id: string): string => `${RUTAS_DE_CUENTAS.lista}/${id}`;

/** Una cuenta como la entrega la composición. */
export type CuentaDeLaLista = Readonly<{
  id: string;
  tipo: string;
  nombre: string;
  identificadorExterno: string | null;
  sucursalId: string;
  activa: boolean;
  version: number;
}>;

export type OpcionDeLista = Readonly<{ valor: string; etiqueta: string }>;
export type SucursalDeLaLista = Readonly<{ id: string; nombre: string }>;

/**
 * Los tipos de cuenta, en el orden de la maqueta (`CTIPOS`), cada uno con la clave de su texto. Una prueba compara esta lista con la del dominio de caja
 * (`TIPOS_DE_CUENTA`): un tipo nuevo sin texto no pasa. «QR» es el mismo texto que el del medio de pago.
 */
const TIPOS: Readonly<Record<string, ClaveDeTexto>> = {
  TERMINAL: "caja.cuentas.tipo.terminal",
  QR: "caja.medios.tipo.qr",
  CUENTA_BANCARIA: "caja.cuentas.tipo.cuenta_bancaria",
};

export const TIPOS_DE_CUENTA_CON_TEXTO: readonly string[] = Object.keys(TIPOS);

/** El texto de un tipo; uno que la pantalla no conoce se dice con su propio valor (nunca se esconde una cuenta por no saber nombrarla). */
const nombreDelTipo = (tipo: string): string =>
  Object.hasOwn(TIPOS, tipo) ? texto({}, TIPOS[tipo] as ClaveDeTexto) : tipo;

/**
 * Una tarjeta por cuenta: su nombre, y debajo «Terminal · T-0481 · Sucursal Centro» (el identificador solo si lo tiene). Una sucursal que la persona ya no puede elegir
 * (cerrada o fuera de su alcance) se dice con su id para no esconder la cuenta; el caso de uso decide qué se puede hacer con ella.
 */
export function armarLaListaDeCuentas(
  cuentas: readonly CuentaDeLaLista[],
  sucursales: readonly SucursalDeLaLista[],
): readonly FilaDeLista[] {
  const nombreDeLaSucursal = (id: string): string =>
    sucursales.find((s) => s.id === id)?.nombre ?? id;
  return cuentas.map((c) => ({
    id: c.id,
    titulo: c.nombre,
    detalle: [nombreDelTipo(c.tipo), c.identificadorExterno, nombreDeLaSucursal(c.sucursalId)]
      .filter((parte): parte is string => parte !== null)
      .join(" · "),
    activo: c.activa,
    estado: estadoDeLista(c.activa),
    sePuedeDesactivar: true,
    version: c.version,
    href: rutaDeUnaCuenta(c.id),
  }));
}

/** Todos los tipos de cuenta, con su texto. En la edición el tipo no se cambia: el formulario lo muestra apagado. */
export const opcionesDeTipoDeCuenta = (): readonly OpcionDeLista[] =>
  TIPOS_DE_CUENTA_CON_TEXTO.map((valor) => ({ valor, etiqueta: nombreDelTipo(valor) }));

/** Las sucursales que ofrece el selector: las abiertas que la persona puede elegir, con su nombre. */
export const opcionesDeSucursal = (
  sucursales: readonly SucursalDeLaLista[],
): readonly OpcionDeLista[] => sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre }));
