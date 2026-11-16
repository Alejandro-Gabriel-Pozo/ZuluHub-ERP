import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeCatalogo, ConsultasDeCatalogo } from "../modulos/catalogo/publico";
import { err } from "../primitivas/resultado/resultado";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { identificador } from "./entradas-de-facturacion";
import { leerElPedidoDeOcultar } from "./entradas-de-ocultar";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";

/**
 * Ocultar un producto de la web (A15; maqueta aprobada `productos.html`, tarjeta de visibilidad de la ficha): ver si el producto está oculto en el local y en toda la empresa, y ocultarlo o
 * volver a mostrarlo en cada alcance. Vive acá, y no en `apps/web`, para probarse con la base real sin levantar Next (igual que `ficha-de-producto-web.ts`).
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/ocultar-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta.** Ver exige `vidrieras.ver`; ocultar o mostrar en un local, `vidrieras.marcar_disponibilidad` (los tres roles; el operador, solo en SUS
 *    locales); en toda la empresa, además `vidrieras.ocultar_en_empresa` (gerente y administrador; dueño, 22A) y alcance sobre todas las sucursales. Acá no se decide ningún permiso.
 *  - **El local lo pone el servidor.** El pedido no trae sucursal: `ocultarEnUnLocal` recibe la sucursal con la que la sesión trabaja. Sin sucursal, el alcance LOCAL cierra (nunca se asume «todas»).
 *  - **Repetir no duplica ni deshace.** El pedido fija un ESTADO (`oculto: true|false`), no alterna: el doble toque es una sola escritura y una sola entrada de auditoría (`yaEstaba`, caso de uso).
 *    Por eso el pedido no lleva clave de idempotencia ni versión: el caso de uso toma el producto con `FOR UPDATE`, así que dos pedidos a la vez se ponen en fila y el último estado pedido gana.
 *  - **Con existencia o conteo abierto, no oculta.** Lo decide el caso de uso (revierte la fila y la auditoría): sale con su texto propio aprobado el 12/11/2026.
 *  - **Nada de más sale.** Lista blanca: solo `local` y `empresa` (si está oculto), ni quién ni cuándo ni los demás productos.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeCatalogo`): un fallo inesperado sale sin detalle y con referencia.
 */

export type DependenciasDeOcultarWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeCatalogo, "ocultarProducto">;
  consultas: () => Pick<ConsultasDeCatalogo, "productosOcultos">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Si el producto está oculto en el local con el que se trabaja (`null` si no hay local) y en toda la empresa. */
export type VisibilidadParaLaPantalla = Readonly<{ local: boolean | null; empresa: boolean }>;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

/**
 * Dónde está oculto un producto. Con `sucursalId` mira ese local y la empresa; sin local mira solo lo de la empresa, y eso solo se le deja a quien tiene alcance sobre todas las
 * sucursales (la consulta lo decide). Es una LECTURA: no escribe ni audita. `productoId` es el de un producto que la página ya leyó de la empresa.
 */
export async function verLaVisibilidadDelProducto(
  d: DependenciasDeOcultarWeb,
  contexto: ContextoOperativo,
  productoId: string,
  sucursalId: string | null,
): Promise<Respuesta<VisibilidadParaLaPantalla>> {
  if (!identificador.safeParse(productoId).success) return { ok: false, error: GENERICO };
  try {
    const ocultos = await d
      .consultas()
      .productosOcultos(contexto, sucursalId === null ? {} : { sucursalId });
    if (!ocultos.ok) return conError(ocultos.error, d);
    const delProducto = ocultos.valor.filter((o) => o.productoId === productoId);
    return {
      ok: true,
      dato: {
        local: sucursalId === null ? null : delProducto.some((o) => o.sucursalId === sucursalId),
        empresa: delProducto.some((o) => o.sucursalId === null),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Lo que devuelve ocultar o mostrar: si no cambió nada (ya estaba) y si la empresa sigue ocultándolo al mostrarlo en un local. */
export type ResultadoDeOcultar = Readonly<{
  productoId: string;
  yaEstaba: boolean;
  sigueOcultoPorLaEmpresa: boolean;
}>;

/**
 * Oculta o vuelve a mostrar un producto en el local `sucursalId` (alcance LOCAL) o en toda la empresa (alcance EMPRESA). Ver las reglas arriba. `sucursalId` lo pone el servidor desde la
 * sesión; con alcance EMPRESA no se usa.
 */
export async function ocultarOMostrarUnProducto(
  d: DependenciasDeOcultarWeb,
  contexto: ContextoOperativo,
  sucursalId: string | null,
  crudo: unknown,
): Promise<Respuesta<ResultadoDeOcultar>> {
  const pedido = leerElPedidoDeOcultar(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  const { productoId, alcance, oculto } = pedido.valor;
  // El alcance LOCAL sin local (nada elegido) cierra: nunca se lo toma por «toda la empresa».
  const destino =
    alcance === "EMPRESA"
      ? ({ tipo: "EMPRESA" } as const)
      : sucursalId === null
        ? null
        : ({ tipo: "SUCURSAL", sucursalId } as const);
  if (destino === null) return { ok: false, error: GENERICO };
  try {
    const hecho = await d
      .casosDeUso()
      .ocultarProducto(contexto, { productoId, alcance: destino, oculto });
    return aRespuesta(
      hecho.ok ? hecho : err(traducirErrorDeCatalogo(hecho.error)),
      d.respuesta,
      (salida) => ({
        productoId,
        yaEstaba: salida.yaEstaba,
        sigueOcultoPorLaEmpresa: salida.sigueOcultoPor === "EMPRESA",
      }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

const conError = (error: unknown, d: DependenciasDeOcultarWeb): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeCatalogo(error), d.respuesta),
});
