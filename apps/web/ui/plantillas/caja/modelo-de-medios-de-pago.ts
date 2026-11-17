import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { RUTAS_DE_CAJA, estadoDeLista, type FilaDeLista } from "./lista-de-caja";

/**
 * El modelo de vista de «Medios de pago» (maqueta aprobada `medios.html`, 09/11/2026): de lo que entrega la lista de la composición, lo que se ve en cada tarjeta
 * y las opciones del formulario. Puro: sin React ni servidor. Los textos salen del catálogo (`caja.*`, con su fuente en `catalogo-caja.ts`); no se arma
 * ningún texto nuevo acá, solo se eligen y se unen los aprobados como lo hace la maqueta.
 */

export const RUTAS_DE_MEDIOS = {
  lista: RUTAS_DE_CAJA.medios,
  nuevo: `${RUTAS_DE_CAJA.medios}/nuevo`,
} as const;

export const rutaDeUnMedio = (id: string): string => `${RUTAS_DE_MEDIOS.lista}/${id}`;

/** Un medio como lo entrega la composición (la misma forma, sin importar de dónde venga). */
export type MedioDeLaLista = Readonly<{
  id: string;
  tipo: string;
  nombre: string | null;
  activo: boolean;
  version: number;
}>;

/**
 * Los tipos de medio, en el orden de la maqueta (`TIPOS`), cada uno con la clave de su texto. Una prueba compara esta lista con la del dominio de caja
 * (`TIPOS_DE_MEDIO`): un tipo nuevo sin texto no pasa. El efectivo es uno por empresa: no se ofrece en el alta.
 */
const TIPOS: Readonly<Record<string, ClaveDeTexto>> = {
  EFECTIVO: "caja.medios.tipo.efectivo",
  TARJETA_DEBITO: "caja.medios.tipo.tarjeta_debito",
  TARJETA_CREDITO: "caja.medios.tipo.tarjeta_credito",
  TRANSFERENCIA: "caja.medios.tipo.transferencia",
  QR: "caja.medios.tipo.qr",
  OTRO: "caja.medios.tipo.otro",
};
const EFECTIVO = "EFECTIVO";

export const TIPOS_DE_MEDIO_CON_TEXTO: readonly string[] = Object.keys(TIPOS);

/** El texto de un tipo; un tipo que la pantalla no conoce se dice con su propio valor (nunca se esconde un medio por no saber nombrarlo). */
const nombreDelTipo = (tipo: string): string =>
  Object.hasOwn(TIPOS, tipo) ? texto({}, TIPOS[tipo] as ClaveDeTexto) : tipo;

export function armarLaListaDeMedios(medios: readonly MedioDeLaLista[]): readonly FilaDeLista[] {
  return medios.map((m) => {
    const tipo = nombreDelTipo(m.tipo);
    const cuenta = texto(
      {},
      m.tipo === EFECTIVO ? "caja.medios.cuenta_no_lleva" : "caja.medios.cuenta_opcional",
    );
    return {
      id: m.id,
      titulo: m.nombre ?? tipo,
      detalle: m.nombre === null ? cuenta : `${tipo} · ${cuenta}`,
      activo: m.activo,
      estado: estadoDeLista(m.activo),
      sePuedeDesactivar: m.tipo !== EFECTIVO,
      version: m.version,
      href: rutaDeUnMedio(m.id),
    };
  });
}

export type OpcionDeTipo = Readonly<{ valor: string; etiqueta: string }>;

/** Los tipos que ofrece el selector: en el alta, todos menos el efectivo (ya existe uno por empresa); en la edición, el del medio (no se cambia). */
export function opcionesDeTipo(original: MedioDeLaLista | null): readonly OpcionDeTipo[] {
  const tipos =
    original === null ? TIPOS_DE_MEDIO_CON_TEXTO.filter((t) => t !== EFECTIVO) : [original.tipo];
  return tipos.map((valor) => ({ valor, etiqueta: nombreDelTipo(valor) }));
}
