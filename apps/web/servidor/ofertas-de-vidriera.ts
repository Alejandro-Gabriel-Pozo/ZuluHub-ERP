import "server-only";
/**
 * FICHA
 * QUÉ ES: Las ofertas de botones del módulo vidriera: carta en línea y ocultar productos.
 * QUÉ NO ES: No lleva la lógica de otro módulo: cada módulo tiene su ofertas-de-MODULO.ts, y las lecturas de permisos pasan por permisos-de-la-persona.ts.
 * QUÉ EXPORTA: OfertaDeLaCarta, ofertaDeLaCartaEnLinea, puedeOcultarEnElLocal, puedeOcultarEnLaEmpresa.
 * QUÉ IMPORTA: permisos-de-la-persona.ts. Lo consumen las páginas, por modulos.ts.
 * Previene: que el archivo común de ofertas vuelva a ser el punto donde chocan todos los PR de pantallas y que una pantalla lea los permisos dos veces por pedido. Chequeo: test/arquitectura/ofertas-por-modulo.test.ts.
 */
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { ofertaDe, permisosDeLaPersona } from "./permisos-de-la-persona";

/** Qué botones de «Carta en línea» se ofrecen activos hoy (una sola lectura de permisos). */
export type OfertaDeLaCarta = Readonly<{ guardar: boolean; poner: boolean; sacar: boolean }>;

/** ¿Qué puede hacer con la carta en línea? La oferta de `vidrieras.editar`, `.publicar_en_linea` y `.retirar_de_linea`; sin permisos legibles, todo `false`. Solo apaga botones: el guard decide. Chequeo: `test/web/carta-en-linea-acceso.test.ts`. */
export async function ofertaDeLaCartaEnLinea(
  contexto: ContextoOperativo,
): Promise<OfertaDeLaCarta> {
  const permisos = await permisosDeLaPersona(contexto);
  if (permisos === null) return { guardar: false, poner: false, sacar: false };
  return {
    guardar: ofertaDe("vidrieras.editar", permisos).permitida,
    poner: ofertaDe("vidrieras.publicar_en_linea", permisos).permitida,
    sacar: ofertaDe("vidrieras.retirar_de_linea", permisos).permitida,
  };
}

/** ¿Puede ocultar o volver a mostrar un producto en un local? La oferta de `vidrieras.marcar_disponibilidad`; sin permisos legibles, `false`. Solo apaga el botón (A15): el guard decide. Chequeo: `test/web/ocultar-acceso.test.ts`. */
export async function puedeOcultarEnElLocal(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe("vidrieras.marcar_disponibilidad", permisos).permitida;
}

/** ¿Puede ocultar o volver a mostrar un producto en toda la empresa? La oferta de `vidrieras.ocultar_en_empresa` (dueño, 22A), con el mismo cierre. Chequeo: `test/web/ocultar-acceso.test.ts`. */
export async function puedeOcultarEnLaEmpresa(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe("vidrieras.ocultar_en_empresa", permisos).permitida;
}
