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
import type { AccionesDeLista } from "../ui/plantillas/caja/lista-de-caja";
import type { DestinoDeModulo } from "../ui/plantillas/sesion/ArmazonDeOperacion";
import type { Pendiente } from "../ui/plantillas/sesion/PantallaDeInicio";

/**
 * Una entrada del menú de módulos: lo que un módulo suma a la barra inferior. Cada módulo nuevo suma UNA entrada a
 * `ENTRADAS_DE_MODULOS` (y su clave a `DestinoDeModulo`); la regla de cuándo se muestra es una sola y vive en `destinosPermitidos`.
 */
export type EntradaDeModulo = Readonly<{
  clave: DestinoDeModulo["clave"];
  /** El módulo del catálogo (`catalogo.ts`) al que pertenece la pantalla. */
  modulo: ClaveModulo;
  /** La acción que exige la pantalla al guard (la misma que su consulta): sin ella no se ofrece. */
  accion: ClaveAccion;
  href: string;
  /** Clave del texto del destino en el catálogo del vocabulario: solo textos ya aprobados por el dueño. */
  etiqueta: ClaveDeTexto;
  icono: DestinoDeModulo["icono"];
}>;

/**
 * Los módulos con pantalla hoy, en el orden en que se ofrecen en la barra. Hoy hay uno: el facturador (Comprobantes).
 * La barra admite como máximo `MAXIMO_DE_DESTINOS_DE_MODULOS` (3) módulos: una prueba (`test/web/modulos-de-la-barra.test.ts`) falla si
 * se suma uno más, para que alguien decida cómo se muestran los demás en vez de cortarlos en silencio (`destinosDeOperacion` recorta).
 * Aprobado por el dueño el 2026-10-29 (respuesta en la sesión web del carril web): el título «Comprobantes» (ver el catálogo).
 */
export const ENTRADAS_DE_MODULOS: readonly EntradaDeModulo[] = [
  {
    clave: "comprobantes",
    modulo: "facturacion",
    accion: "comprobantes.ver",
    href: RUTA_DEL_LISTADO,
    etiqueta: "fiscal.pantalla.listado_titulo",
    icono: "comprobantes",
  },
];

/**
 * De las entradas, las que la persona ve hoy. Todo nace cerrado: una entrada se muestra solo si el módulo está `disponible` en el
 * catálogo (uno «en desarrollo» no da permisos a nadie), la empresa lo tiene activo o en solo lectura y la persona tiene la acción
 * según `permisosDelActor` (calculado por el servidor). SUPUESTO (DEC-0059) declarado: en solo lectura SÍ se muestra, porque el
 * Listado solo consulta (D-59 habla de botones apagados, no de ocultar consultas); revertirlo es quitar `enSoloLectura` de la
 * condición. Sin permisos leídos (`null`) no se muestra nada. Ocultar no es autorizar: la pantalla vuelve a pasar por el guard.
 */
export function destinosPermitidos(
  entradas: readonly EntradaDeModulo[],
  permisos: PermisosLeidos | null,
): readonly DestinoDeModulo[] {
  if (permisos === null) return [];
  return entradas
    .filter(
      (e) =>
        CATALOGO_DE_MODULOS[e.modulo].estado === "disponible" &&
        permisos.acciones.includes(e.accion) &&
        (permisos.modulos.activos.includes(e.modulo) ||
          permisos.modulos.enSoloLectura.includes(e.modulo)),
    )
    .map((e) => ({
      clave: e.clave,
      href: e.href,
      etiqueta: texto({}, e.etiqueta),
      icono: e.icono,
    }));
}

/** Los destinos de los módulos que la persona ve hoy. Si `permisosDelActor` falla, ninguno (cierra, no abre) y la pantalla sigue andando. */
export async function destinosDeModulos(
  contexto: ContextoOperativo,
): Promise<readonly DestinoDeModulo[]> {
  return destinosPermitidos(ENTRADAS_DE_MODULOS, await permisosDeLaPersona(contexto));
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
 * ¿La persona puede emitir una factura hoy? Depende SOLO de que `permisosDelActor().acciones` incluya `comprobantes.emitir_manual`, la
 * acción que el guard de emitir exige (`DECLARACIONES_DE_FACTURACION.emitirComprobanteManual`) y la de las dos lecturas de Emitir.
 * Esa lista sale del mismo cálculo que el guard (`accionesPermitidas`), así que sigue su regla sin repetirla: esa acción es
 * `CREA_AMPLIA` (`catalogo.ts`), que el guard rechaza con el módulo en solo lectura, y entonces el botón NO se ofrece ahí (a
 * diferencia de anular, que sí). Si `permisosDelActor` falla, no se ofrece (cierra, no abre). Ocultar no es autorizar: la acción vuelve a
 * pasar por el guard, dentro de su transacción. Chequeo: `test/web/modulos-de-la-barra.test.ts`.
 */
export async function puedeEmitirFacturas(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && permisos.acciones.includes("comprobantes.emitir_manual");
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

/**
 * ¿La persona puede editar el contacto de la sucursal (D-113)? Es la oferta de `sucursales.editar` (gerente y administrador) que el
 * servidor calcula con `ofertaDe`: con el módulo en solo lectura o sin el rol, no. Si no se pudieron leer los permisos, `false`
 * (cierra, no abre). Ocultar no es autorizar: la ficha y el guardado vuelven a pasar por el guard. Chequeo:
 * `test/web/contacto-de-sucursal-acceso.test.ts`.
 */
export async function puedeEditarElContactoDeLaSucursal(
  contexto: ContextoOperativo,
): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe("sucursales.editar", permisos).permitida;
}

/**
 * ¿La persona puede guardar los datos de un producto? Es la oferta de `productos.editar` (gerente y administrador) que el servidor calcula con `ofertaDe`: con el módulo en solo
 * lectura o sin el rol, no. Si no se pudieron leer los permisos, `false` (cierra, no abre). Ocultar no es autorizar: guardar vuelve a pasar por el guard. Es solo la ayuda que apaga
 * «Guardar» (DEC-0346, aprobada por el dueño el 12/11/2026). Chequeo: `test/web/ficha-de-producto-acceso.test.ts`.
 */
export async function puedeEditarProductos(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe("productos.editar", permisos).permitida;
}

/**
 * ¿La persona puede crear un producto? Es la oferta de `productos.crear` (gerente y administrador) que el servidor calcula con `ofertaDe`: con el módulo en solo lectura o sin el rol, no.
 * Si no se pudieron leer los permisos, `false` (cierra, no abre). Ocultar no es autorizar: crear vuelve a pasar por el guard. Es solo la ayuda que apaga «Guardar» (DEC-0346, aprobada
 * por el dueño el 12/11/2026). Chequeo: `test/web/alta-de-producto-acceso.test.ts`.
 */
export async function puedeCrearProductos(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe("productos.crear", permisos).permitida;
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
 * pedido). «Pasar a producción» (`puntos_de_venta.cambiar_ambiente`) es del módulo `facturacion` (`disponible` desde 2026-11-04, pero
 * activo solo en las empresas donde la plataforma lo activó): sale apagado, con el motivo que da el servidor, si el módulo no está activo
 * para la empresa o el rol no alcanza; las demás son de `administracion`. Si no se pudieron leer los permisos, TODO sale apagado
 * con el genérico de D-82, «Esta acción no está permitida.» (ante un error o una duda el sistema cierra, `CLAUDE.md`; igual que
 * `puedeEmitirNotasDeCredito` y la barra).
 * Previene: ofrecer un botón que el guard va a rechazar sin saber si la persona puede. Es solo una ayuda: ocultar o apagar no es
 * autorizar, cada acción vuelve a pasar por el guard dentro de su transacción.
 */
export async function accionesDePuntosDeVenta(
  contexto: ContextoOperativo,
): Promise<AccionesDePuntosDeVenta> {
  const permisos = await permisosDeLaPersona(contexto);
  const de = (accion: ClaveAccion): OfertaDeAccion =>
    permisos === null
      ? { permitida: false, motivo: texto({}, "fiscal.pantalla.config_pv_accion_no_permitida") }
      : ofertaDe(accion, permisos);
  return {
    agregar: de("puntos_de_venta.crear"),
    editar: de("puntos_de_venta.editar"),
    activar: de("puntos_de_venta.activar"),
    desactivar: de("puntos_de_venta.desactivar"),
    pasarAProduccion: de("puntos_de_venta.cambiar_ambiente"),
  };
}

/**
 * Qué botones de una lista de la configuración de caja se ofrecen activos hoy (`medios_de_pago.*`, `cuentas_de_cobro.*` o `cajas.*`, módulo `caja`): los que el SERVIDOR deja
 * hacer según `permisosDelActor` (una lectura por pedido, el mismo cálculo que el guard). Con `caja` en desarrollo o no activo esa lista no trae sus acciones: todo apagado. Sin
 * permisos leídos, todo apagado. Previene: ofrecer un botón que el guard va a rechazar. Es solo una ayuda: cada acción vuelve a pasar por el guard dentro de su transacción.
 */
export async function accionesDeLaListaDeCaja(
  contexto: ContextoOperativo,
  familia: "medios_de_pago" | "cuentas_de_cobro" | "cajas",
): Promise<AccionesDeLista> {
  const permisos = await permisosDeLaPersona(contexto);
  const puede = (accion: ClaveAccion): boolean =>
    permisos !== null && permisos.acciones.includes(accion);
  return {
    agregar: puede(`${familia}.crear`),
    editar: puede(`${familia}.editar`),
    desactivar: puede(`${familia}.desactivar`),
    reactivar: puede(`${familia}.reactivar`),
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
