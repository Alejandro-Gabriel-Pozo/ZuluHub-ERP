import "server-only";
/**
 * ARCHIVO CENTRAL
 * QUÉ ES: el armado del menú para la persona (áreas, destinos de la barra, pantallas de Cuenta) y la lista de reexportaciones de compatibilidad de las ofertas de botones.
 * QUÉ NO ES: el lugar de las funciones «¿puede…?» de cada pantalla: una oferta nueva va en su parte dedicada y no se reexporta acá.
 * EXPORTA: destinosDeAreas, destinosDeModulos, pantallasDeCuenta, ACCION_DE_CONFIGURACION_FISCAL, puedeVerLaConfiguracionFiscal, pendientesDeLaEmpresa, accionesDePuntosDeVenta, puedeEditarElContactoDeLaSucursal, accionesDeLaListaDeCaja, puedeEditarProductos, puedeCrearProductos, puedeCambiarPrecios, puedeEditarOpciones, OfertaDeLaCarta, ofertaDeLaCartaEnLinea, puedeOcultarEnElLocal, puedeOcultarEnLaEmpresa, puedeEmitirNotasDeCredito, puedeEmitirFacturas, puedeAdministrarMesas, puedeCambiarDeMesa, puedeUnirMesas, puedeDividirCuentas, puedeEnviarAComandas, puedeImprimir, puedeReimprimir, puedeAdministrarImpresoras.
 * IMPORTA: server-only, src/contexto/contexto, src/capacidades/vocabulario/vocabulario, src/capacidades/modulos/catalogo, apps/web/ui/navegacion/menu, apps/web/ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta, apps/web/ui/plantillas/sesion/*, apps/web/servidor/permisos-de-la-persona, apps/web/servidor/ofertas-de-*, apps/web/servidor/configuracion-fiscal.
 * PARTE DEDICADA: apps/web/servidor/ofertas-de-<módulo>.ts (las ofertas de cada módulo) y apps/web/servidor/permisos-de-la-persona.ts (la lectura de permisos).
 */
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { texto } from "../../../src/capacidades/vocabulario/vocabulario";
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import {
  FILAS_DEL_MENU,
  armarElMenu,
  type ClaveDeFila,
  type ItemDelMenu,
} from "../ui/navegacion/menu";
import {
  RUTAS_DE_CONFIGURACION,
  armarLaLista,
} from "../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import type { DestinoDeModulo } from "../ui/plantillas/sesion/ArmazonDeOperacion";
import type { Pendiente } from "../ui/plantillas/sesion/PantallaDeInicio";
import { permisosDeLaPersona, type PermisosLeidos } from "./permisos-de-la-persona";

/**
 * Los destinos de la barra inferior: las áreas del menú (`ui/navegacion/menu.ts`, la única tabla) con lo que la persona ve hoy. La barra
 * admite como máximo `MAXIMO_DE_DESTINOS_DE_MODULOS` (3) áreas sin contar Cuenta, que es fija; el tope lo vigila
 * `test/arquitectura/menu-por-areas.test.ts` para que alguien decida cómo se muestran las demás en vez de cortarlas en silencio
 * (`destinosDeOperacion` recorta). La regla de cuándo se muestra una pantalla es una sola: `armarElMenu` (todo nace cerrado).
 * Un área con una sola pantalla lleva directo a ella; con varias, abre una hoja con sus grupos.
 */
export function destinosDeAreas(
  permisos: PermisosLeidos | null,
  departamentoElegido: string | null,
): readonly DestinoDeModulo[] {
  return armarElMenu(FILAS_DEL_MENU, permisos, departamentoElegido)
    .filter((area) => !area.fija)
    .map((area): DestinoDeModulo => {
      const pantallas = area.grupos
        .flatMap((g) => g.items)
        .filter(
          (i): i is ItemDelMenu & Readonly<{ href: string }> =>
            i.tipo === "pantalla" && i.href !== null,
        );
      const [primera] = pantallas;
      // Un área solo existe con al menos una pantalla visible; sin ella (solo acciones) no es un destino de la barra.
      if (primera === undefined) throw new RangeError("menú: un área de la barra sin pantallas");
      const base = { etiqueta: texto({}, area.etiqueta), icono: area.icono };
      if (pantallas.length === 1) return { ...base, clave: primera.clave, href: primera.href };
      return {
        ...base,
        clave: area.clave,
        href: primera.href,
        hoja: area.grupos.map((g) => ({
          etiqueta: g.etiqueta === null ? null : texto({}, g.etiqueta),
          enlaces: g.items
            .filter((i): i is typeof i & Readonly<{ href: string }> => i.href !== null)
            .map((i) => ({ clave: i.clave, etiqueta: texto({}, i.etiqueta), href: i.href })),
        })),
      };
    });
}

/** Los destinos de las áreas que la persona ve hoy. Si `permisosDelActor` falla, ninguno (cierra, no abre) y la pantalla sigue andando. */
export async function destinosDeModulos(
  contexto: ContextoOperativo,
): Promise<readonly DestinoDeModulo[]> {
  // Sin departamento elegido: hoy ninguna fila lleva departamento (columna reservada, A2c) y sin elección nunca se asume «todos».
  return destinosDeAreas(await permisosDeLaPersona(contexto), null);
}

/** Las pantallas del menú del área Cuenta que la persona ve hoy, por clave: la página de Cuenta las ofrece desde la misma tabla. */
export async function pantallasDeCuenta(
  contexto: ContextoOperativo,
): Promise<ReadonlyMap<ClaveDeFila, Readonly<{ texto: string; href: string }>>> {
  const cuenta = armarElMenu(FILAS_DEL_MENU, await permisosDeLaPersona(contexto), null).find(
    (a) => a.clave === "cuenta",
  );
  const lista = (cuenta?.grupos ?? []).flatMap((g) => g.items);
  return new Map(
    lista.flatMap((i) =>
      i.href === null ? [] : [[i.clave, { texto: texto({}, i.etiqueta), href: i.href }] as const],
    ),
  );
}

/**
 * La acción con la que ya se protege la pantalla de Configuración fiscal: la consulta de su lista la exige al guard
 * (`estadoDeLaConfiguracionFiscal`, solo el gerente). Previene: ofrecer la entrada a quien el servidor va a rechazar. Chequeo:
 * `test/web/modulos-de-la-barra.test.ts` la compara con la declaración de la consulta.
 */
export const ACCION_DE_CONFIGURACION_FISCAL: ClaveAccion = accionDeLaFila("configuracion-fiscal");

/** La acción que la tabla del menú declara para una pantalla: una regla, un lugar. */
function accionDeLaFila(clave: ClaveDeFila): ClaveAccion {
  const fila = FILAS_DEL_MENU.find((f) => f.clave === clave);
  if (fila === undefined || fila.tipo !== "pantalla")
    throw new RangeError(`menú: la fila ${clave} no es una pantalla`);
  return fila.accion;
}

/**
 * ¿La persona puede entrar a Configuración fiscal? Mismo permiso que la pantalla, según `permisosDelActor`. Si no se pudieron leer
 * los permisos, `false` (cierra, no abre). Ocultar no es autorizar: la pantalla vuelve a pasar por el guard.
 */
export async function puedeVerLaConfiguracionFiscal(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && permisos.acciones.includes(ACCION_DE_CONFIGURACION_FISCAL);
}

/** De un error, solo su TIPO para el registro: nunca el mensaje ni datos (pueden traer algo de la empresa). */
const tipoDelError = (excepcion: unknown): string =>
  excepcion instanceof Error ? excepcion.name : typeof excepcion;

/**
 * La ranura «lo que falta» del inicio. Hoy un solo pendiente: «Completá la configuración fiscal.», que lleva a la lista, si la
 * persona tiene el permiso de esa pantalla Y alguna fila de la lista lleva cartel (el mismo cálculo que la lista: `armarLaLista`).
 * Dueño, 2026-10-29, cuestionario B (21:11Z), pregunta 1. Si la lectura falla no muestra nada y deja en el registro del servidor el
 * TIPO del error (el código del rechazo o el nombre de la excepción), nunca el mensaje.
 */
export async function pendientesDeLaEmpresa(
  contexto: ContextoOperativo,
): Promise<readonly Pendiente[]> {
  if (!(await puedeVerLaConfiguracionFiscal(contexto))) return [];
  try {
    // Se carga recién acá: solo Inicio la usa, y así las demás pantallas (que pasan por este archivo en la barra) no arrastran la
    // composición fiscal entera.
    const { cargarElEstadoDeLaConfiguracion } = await import("./configuracion-fiscal");
    const estado = await cargarElEstadoDeLaConfiguracion(contexto);
    if (!estado.ok) {
      console.error(`[inicio] no se pudo leer la configuración fiscal: ${estado.error.codigo}`);
      return [];
    }
    return armarLaLista(estado.dato).some((fila) => fila.cartel !== null)
      ? [
          {
            id: "configuracion-fiscal",
            titulo: texto({}, "fiscal.pantalla.config_pendiente_inicio"),
            href: RUTAS_DE_CONFIGURACION.lista,
          },
        ]
      : [];
  } catch (excepcion) {
    console.error(`[inicio] no se pudo leer la configuración fiscal: ${tipoDelError(excepcion)}`);
    return [];
  }
}

/**
 * Compatibilidad: las ofertas de botones viven en `ofertas-de-<módulo>.ts` y se reexportan acá para que ninguna página ni prueba cambie
 * su import. Esta lista solo baja: no se agregan nombres (una oferta nueva va en el archivo de su módulo). Chequeo:
 * `test/arquitectura/ofertas-por-modulo.test.ts`.
 */
export {
  accionesDePuntosDeVenta,
  puedeEditarElContactoDeLaSucursal,
} from "./ofertas-de-administracion";
export { accionesDeLaListaDeCaja } from "./ofertas-de-caja";
export {
  puedeCambiarPrecios,
  puedeCrearProductos,
  puedeEditarOpciones,
  puedeEditarProductos,
} from "./ofertas-de-catalogo";
export {
  puedeAdministrarImpresoras,
  puedeEnviarAComandas,
  puedeImprimir,
  puedeReimprimir,
} from "./ofertas-de-comandas";
export { puedeEmitirFacturas, puedeEmitirNotasDeCredito } from "./ofertas-de-facturacion";
export {
  puedeAdministrarMesas,
  puedeCambiarDeMesa,
  puedeDividirCuentas,
  puedeUnirMesas,
} from "./ofertas-de-salon";
export {
  ofertaDeLaCartaEnLinea,
  puedeOcultarEnElLocal,
  puedeOcultarEnLaEmpresa,
  type OfertaDeLaCarta,
} from "./ofertas-de-vidriera";
