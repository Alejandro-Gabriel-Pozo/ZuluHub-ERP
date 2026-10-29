import "server-only";
import { cache } from "react";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { texto } from "../../../src/capacidades/vocabulario/vocabulario";
import {
  CATALOGO_DE_MODULOS,
  type ClaveAccion,
  type ClaveModulo,
} from "../../../src/capacidades/modulos/catalogo";
import type { ClaveDeTexto } from "../../../src/capacidades/vocabulario/catalogo";
import { web } from "./composicion";
import {
  RUTAS_DE_CONFIGURACION,
  armarLaLista,
} from "../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import type {
  AccionesDePuntosDeVenta,
  OfertaDeAccion,
} from "../ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta";
import { RUTA_DEL_LISTADO } from "../ui/plantillas/facturacion/filtros-del-listado";
import type { DestinoDeModulo } from "../ui/plantillas/sesion/ArmazonDeOperacion";
import type { Pendiente } from "../ui/plantillas/sesion/PantallaDeInicio";

/**
 * Lo que cada módulo suma al armazón: sus destinos de la barra inferior y lo que falta hacer en el inicio.
 * Hoy hay uno: el facturador (Comprobantes). Los demás tramos de los módulos agregan sus entradas acá.
 *
 * «Comprobantes» se muestra solo si la persona tiene hoy la acción `comprobantes.ver` Y el módulo `facturacion` está activo o en
 * solo lectura, según `permisosDelActor` (calculado por el servidor). SUPUESTO declarado: en solo lectura SÍ se muestra, porque el
 * Listado solo consulta (D-59 habla de botones apagados, no de ocultar consultas); revertirlo es quitar `enSoloLectura` de la
 * condición. Si `permisosDelActor` falla, la entrada NO se muestra (cierra, no abre) y la pantalla sigue andando. Ocultar no es
 * autorizar: la consulta vuelve a pasar por el guard.
 */
export async function destinosDeModulos(
  contexto: ContextoOperativo,
): Promise<readonly DestinoDeModulo[]> {
  const permisos = await permisosDeLaPersona(contexto);
  const veComprobantes =
    permisos !== null &&
    permisos.acciones.includes("comprobantes.ver") &&
    (permisos.modulos.activos.includes("facturacion") ||
      permisos.modulos.enSoloLectura.includes("facturacion"));
  return veComprobantes
    ? [
        {
          clave: "comprobantes",
          href: RUTA_DEL_LISTADO,
          // Aprobado por el dueño el 2026-10-29 (respuesta en la sesión web del carril web): el título «Comprobantes» (ver el catálogo).
          etiqueta: texto({}, "fiscal.pantalla.listado_titulo"),
          icono: "comprobantes",
        },
      ]
    : [];
}

/**
 * ¿La persona puede emitir notas de crédito hoy? Depende SOLO de que `permisosDelActor().acciones` incluya `notas_de_credito.emitir`:
 * esa lista sale del mismo cálculo que el guard, y esa acción es `COMPLETA_CIERRA` (`src/capacidades/modulos/catalogo.ts`), que el
 * guard deja pasar también con el módulo en solo lectura. Por eso el botón y la pantalla de anular SÍ se ofrecen en solo lectura
 * (corrección del dueño, 2026-10-29, cuestionario en la sesión web del carril web). Si `permisosDelActor` falla, no se ofrece
 * (cierra, no abre). Ocultar no es autorizar: la acción vuelve a pasar por el guard, dentro de su transacción.
 */
export async function puedeEmitirNotasDeCredito(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && permisos.acciones.includes("notas_de_credito.emitir");
}

/**
 * Los permisos de la persona, o `null` si no se pudieron leer (un rechazo o una excepción): la barra y el botón de anular no abren
 * nada por las dudas. Una excepción no se traga en silencio: queda en el registro del servidor, con el mismo formato que los demás
 * (`[etiqueta] qué falló (Tipo)`), SOLO el tipo de la falla, nunca su texto (puede traer datos de la base). Previene: que una base
 * caída deje la barra vacía sin que nadie lo vea. Chequeo: `test/web/modulos-de-la-barra.test.ts`.
 *
 * Con `cache` de React se lee UNA vez por pedido: la barra y los botones de la página comparten el mismo `contexto` (la misma
 * referencia), así que la segunda llamada no vuelve a abrir una transacción. Previene: dos lecturas de los permisos por pantalla.
 */
const permisosDeLaPersona = cache(async (contexto: ContextoOperativo) => {
  try {
    const permisos = await web.consultasDeEmpresas().permisosDelActor(contexto);
    return permisos.ok ? permisos.valor : null;
  } catch (error) {
    console.error(
      `[modulos] no se pudieron leer los permisos de la persona (${error instanceof Error ? error.name : "falla que no es un Error"})`,
    );
    return null;
  }
});

/**
 * La acción con la que ya se protege la pantalla de Configuración fiscal: la consulta de su lista la exige al guard
 * (`estadoDeLaConfiguracionFiscal`, solo el gerente). Previene: ofrecer la entrada a quien el servidor va a rechazar. Chequeo:
 * `test/web/modulos-de-la-barra.test.ts` la compara con la declaración de la consulta.
 */
export const ACCION_DE_CONFIGURACION_FISCAL: ClaveAccion = "datos_fiscales.editar";

/**
 * ¿La persona puede entrar a Configuración fiscal? Mismo permiso que la pantalla, según `permisosDelActor`. Si no se pudieron leer
 * los permisos, `false` (cierra, no abre). Ocultar no es autorizar: la pantalla vuelve a pasar por el guard.
 */
export async function puedeVerLaConfiguracionFiscal(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && permisos.acciones.includes(ACCION_DE_CONFIGURACION_FISCAL);
}

type PermisosLeidos = NonNullable<Awaited<ReturnType<typeof permisosDeLaPersona>>>;

/** De una acción, su módulo, el estado de construcción de ese módulo y su efecto: el catálogo es el único dueño de esos datos. */
function dondeVive(accion: ClaveAccion): {
  modulo: ClaveModulo;
  enDesarrollo: boolean;
  creaAmplia: boolean;
} {
  for (const [modulo, definicion] of Object.entries(CATALOGO_DE_MODULOS) as [
    ClaveModulo,
    (typeof CATALOGO_DE_MODULOS)[ClaveModulo],
  ][]) {
    const acciones: Readonly<Record<string, { efecto: string }>> = definicion.acciones;
    const propia = Object.hasOwn(acciones, accion) ? acciones[accion] : undefined;
    if (propia !== undefined) {
      return {
        modulo,
        enDesarrollo: definicion.estado === "en_desarrollo",
        creaAmplia: propia.efecto === "CREA_AMPLIA",
      };
    }
  }
  throw new Error(`La acción ${accion} no está en el catálogo de módulos`);
}

/**
 * Si el servidor deja hacer `accion` hoy y, si no, el motivo con un texto que YA existe en el catálogo. Sigue el mismo orden que
 * el guard (`evaluarGuard`): en desarrollo, módulo no activo, módulo en solo lectura (solo para las acciones que crean o amplían) y,
 * por último, el rol. `permisosDelActor` no devuelve los módulos en desarrollo ni los no activos (ni sus acciones): por eso «en
 * desarrollo» se distingue mirando el catálogo.
 */
function ofertaDe(accion: ClaveAccion, permisos: PermisosLeidos): OfertaDeAccion {
  if (permisos.acciones.includes(accion)) return { permitida: true, motivo: null };
  const { modulo, enDesarrollo, creaAmplia } = dondeVive(accion);
  const enSoloLectura = permisos.modulos.enSoloLectura.includes(modulo);
  let clave: ClaveDeTexto = "motivo.sin_permiso";
  if (enDesarrollo) clave = "motivo.modulo_en_desarrollo";
  else if (!enSoloLectura && !permisos.modulos.activos.includes(modulo))
    clave = "motivo.modulo_no_activo";
  else if (enSoloLectura && creaAmplia) clave = "motivo.modulo_en_solo_lectura";
  return { permitida: false, motivo: texto({}, clave) };
}

/**
 * Qué botones de Puntos de venta se ofrecen activos hoy, según lo que el SERVIDOR deja hacer (`permisosDelActor`, una lectura por
 * pedido). «Pasar a producción» (`puntos_de_venta.cambiar_ambiente`) es del módulo `facturacion`, en desarrollo: sale apagado con
 * «Esta función todavía está en desarrollo.»; las demás son de `administracion`. Si no se pudieron leer los permisos, TODO sale apagado
 * con `motivo.sin_permiso` (ante un error o una duda el sistema cierra, `CLAUDE.md`; igual que `puedeEmitirNotasDeCredito` y la barra).
 * Previene: ofrecer un botón que el guard va a rechazar sin saber si la persona puede. Es solo una ayuda: ocultar o apagar no es
 * autorizar, cada acción vuelve a pasar por el guard dentro de su transacción.
 */
export async function accionesDePuntosDeVenta(
  contexto: ContextoOperativo,
): Promise<AccionesDePuntosDeVenta> {
  const permisos = await permisosDeLaPersona(contexto);
  const de = (accion: ClaveAccion): OfertaDeAccion =>
    permisos === null
      ? { permitida: false, motivo: texto({}, "motivo.sin_permiso") }
      : ofertaDe(accion, permisos);
  return {
    agregar: de("puntos_de_venta.crear"),
    editar: de("puntos_de_venta.editar"),
    activar: de("puntos_de_venta.activar"),
    desactivar: de("puntos_de_venta.desactivar"),
    pasarAProduccion: de("puntos_de_venta.cambiar_ambiente"),
  };
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
