import "server-only";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { texto } from "../../../src/capacidades/vocabulario/vocabulario";
import { web } from "./composicion";
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
 */
async function permisosDeLaPersona(contexto: ContextoOperativo) {
  try {
    const permisos = await web.consultasDeEmpresas().permisosDelActor(contexto);
    return permisos.ok ? permisos.valor : null;
  } catch (error) {
    console.error(
      `[modulos] no se pudieron leer los permisos de la persona (${error instanceof Error ? error.name : "falla que no es un Error"})`,
    );
    return null;
  }
}

/** La ranura «lo que falta» del inicio (en v1 [FAC]: datos fiscales, punto de venta, certificado). Vacía hasta entonces. */
export function pendientesDeLaEmpresa(): readonly Pendiente[] {
  return [];
}
