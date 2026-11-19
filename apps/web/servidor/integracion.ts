import "server-only";
/**
 * Lo que una pantalla entrega y recibe de las operaciones contextuales (escalabilidad X-1). La pantalla de origen entrega su
 * CONTEXTO (tipo, id y su propia ruta) y acá se decide qué dibujar: nada, una operación directa o la hoja «Más». La decisión
 * vive acá y no en cada pantalla.
 *
 * Ofrecer NO autoriza: la pantalla de cada operación vuelve a buscar la cosa por su id filtrando por la empresa de la sesión y
 * vuelve a pasar por el guard. Todo nace cerrado: permisos sin leer, referencia inválida o `volver` ajeno dan «NINGUNA», con una
 * línea en el registro del servidor con el tipo de contexto y el motivo, NUNCA el id. Chequeo: `test/web/integracion.test.ts`.
 */
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { CATALOGO_DE_MODULOS } from "../../../src/capacidades/modulos/catalogo";
import { CONTEXTOS } from "../../../src/capacidades/integracion/contextos";
import { OPERACIONES } from "../../../src/capacidades/integracion/operaciones";
import {
  operacionesOfrecidas,
  type PermisosParaOfrecer,
} from "../../../src/capacidades/integracion/ofrecer";
import {
  RUTA_DE_LA_HOJA_DE_MAS,
  direccionConSobre,
  esRutaPropia,
  type Referencia,
  type SobreDeContexto,
} from "../../../src/capacidades/integracion/sobre";
import type { OperacionContextual } from "../../../src/capacidades/integracion/tipos";
import type { ClaveDeTexto } from "../../../src/capacidades/vocabulario/catalogo";
import { texto } from "../../../src/capacidades/vocabulario/vocabulario";
import { esUuidCanonico } from "../../../src/primitivas/identificadores/marca";
import { permisosDeLaPersona } from "./permisos-de-la-persona";

export type OperacionOfrecida = Readonly<{ id: string; etiqueta: string; href: string }>;

/** Lo que la pantalla tiene que dibujar. */
export type OfertaDeOperaciones =
  | Readonly<{ modo: "NINGUNA" }>
  | Readonly<{ modo: "DIRECTA"; operacion: OperacionOfrecida }>
  | Readonly<{ modo: "MAS"; href: string; cantidad: number }>;

/** Los registros que usan las versiones puras (las pruebas pasan los suyos de mentira). */
export type RegistrosDeIntegracion = Readonly<{
  catalogo: Readonly<Record<string, Readonly<{ estado: string }>>>;
  contextos: Readonly<Record<string, unknown>>;
  operaciones: readonly OperacionContextual<string>[];
  etiquetaDe: (clave: ClaveDeTexto) => string;
  registrar: (linea: string) => void;
}>;

const NINGUNA: OfertaDeOperaciones = { modo: "NINGUNA" };

const aOfrecida = (
  r: RegistrosDeIntegracion,
  o: OperacionContextual<string>,
  sobre: SobreDeContexto,
): OperacionOfrecida => ({
  id: o.id,
  etiqueta: r.etiquetaDe(o.etiqueta),
  href: direccionConSobre(o.seAbreEn, sobre),
});

/** Versión pura de `operacionesPara`. */
export function armarOferta(
  r: RegistrosDeIntegracion,
  permisos: PermisosParaOfrecer | null,
  referencia: Referencia,
  volver: string,
): OfertaDeOperaciones {
  const cierra = (motivo: string): OfertaDeOperaciones => {
    r.registrar(`[integracion] sin operaciones para el contexto ${referencia.tipo}: ${motivo}`);
    return NINGUNA;
  };
  if (!Object.hasOwn(r.contextos, referencia.tipo))
    return cierra("contexto que no está en el registro");
  if (!esUuidCanonico(referencia.id)) return cierra("referencia inválida");
  if (!esRutaPropia(volver)) return cierra("ruta de vuelta inválida");
  if (permisos === null) return cierra("permisos sin leer");
  const ofrecidas = operacionesOfrecidas(r.catalogo, r.operaciones, permisos, referencia.tipo);
  const [primera] = ofrecidas;
  if (primera === undefined) return NINGUNA;
  const sobre: SobreDeContexto = { referencia, volver };
  if (ofrecidas.length === 1) return { modo: "DIRECTA", operacion: aOfrecida(r, primera, sobre) };
  return {
    modo: "MAS",
    href: direccionConSobre(RUTA_DE_LA_HOJA_DE_MAS, sobre),
    cantidad: ofrecidas.length,
  };
}

/** Versión pura de `operacionesDeLaHoja`: la lista completa, ya filtrada y ordenada. */
export function armarLaHoja(
  r: RegistrosDeIntegracion,
  permisos: PermisosParaOfrecer | null,
  sobre: SobreDeContexto,
): readonly OperacionOfrecida[] {
  if (permisos === null) {
    r.registrar(
      `[integracion] hoja sin operaciones para el contexto ${sobre.referencia.tipo}: permisos sin leer`,
    );
    return [];
  }
  return operacionesOfrecidas(r.catalogo, r.operaciones, permisos, sobre.referencia.tipo).map((o) =>
    aOfrecida(r, o, sobre),
  );
}

const REGISTROS: RegistrosDeIntegracion = {
  catalogo: CATALOGO_DE_MODULOS,
  contextos: CONTEXTOS,
  operaciones: OPERACIONES,
  etiquetaDe: (clave) => texto({}, clave),
  registrar: (linea) => console.error(linea),
};

/** Para la pantalla de origen. `volver` es su propia ruta. */
export async function operacionesPara(
  contexto: ContextoOperativo,
  referencia: Referencia,
  volver: string,
): Promise<OfertaDeOperaciones> {
  return armarOferta(REGISTROS, await permisosDeLaPersona(contexto), referencia, volver);
}

/** Para la hoja «Más»: la lista completa, ya filtrada y ordenada. La consume el PR de la hoja (X-1c). */
export async function operacionesDeLaHoja(
  contexto: ContextoOperativo,
  sobre: SobreDeContexto,
): Promise<readonly OperacionOfrecida[]> {
  return armarLaHoja(REGISTROS, await permisosDeLaPersona(contexto), sobre);
}
