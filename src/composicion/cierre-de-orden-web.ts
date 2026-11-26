import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeProduccion, ConsultasDeProduccion } from "../modulos/produccion/publico";
import { CONTROL_DE_NEGATIVO } from "../modulos/stock/publico";
import { err, ok } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeOrden } from "./entradas-de-produccion";
import { entradaDeCierreDeOrden } from "./entradas-de-cierre-de-orden";
import { traducirErrorDeProduccion } from "./errores-de-produccion";
import { accionDeProduccion } from "./produccion-web";

/**
 * «Cerrar con lo real» (maqueta `produccion.html`, spec `pantallas-de-produccion-inventario.md` §5): lo que se muestra para cerrar una orden abierta y el cierre. Vive acá, y no en `apps/web`, para probarse con
 * la base real sin levantar Next (igual que `nueva-orden-web.ts`).
 *
 * Reglas que cumple (cada una con su prueba en `cierre-de-orden-web.test.ts` y `test/integracion/cierre-de-orden-web.test.ts`):
 *  - **Los renglones salen de la orden, no del navegador.** La pantalla manda lo real de cada ingrediente por POSICIÓN; el servidor relee la ficha y arma cada consumo con el producto y la unidad de SU renglón. Una
 *    cantidad de renglones que no coincide, o una orden que no es de la empresa o de la sucursal en alcance, sale como el genérico. La unidad de lo obtenido es la del producto de la orden.
 *  - **Cerrar es una sola transacción del caso de uso** (consumo, producto con lote y costo, estado, auditoría): si algo falla no queda nada. Dos cierres a la vez: la fila de la orden se bloquea y el segundo relee.
 *  - **Repetir no duplica.** La clave es el UUID que fija la página al armar el formulario: el mismo gesto devuelve el mismo cierre con `yaExistia`. Una orden ya cerrada con el mismo contenido también (aunque venga otra clave);
 *    con otro contenido, el genérico. Por eso cerrar NO mira el estado de la ficha: lo decide el caso de uso.
 *  - **El costo no se calcula acá.** Lo congela el caso de uso con el promedio del libro (dinero exacto, redondeo una vez); la pantalla no lo muestra al cargar (SUPUESTO S-4) y la ficha lo trae solo con `costos.ver`.
 *  - **«Producir igual» es reenviar con la misma clave y `confirmar`.** Con el control en AVISAR y faltante de insumo, sin confirmar sale el aviso `STOCK_CONTROL_AVISA` y no se escribe nada; el detalle no sale.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016): el vencimiento que falta o ya pasó, con su texto de Lotes; los demás errores de la orden, el genérico; un fallo inesperado, sin detalle y con referencia.
 * Previene: consumir un ingrediente que no es de la orden, cerrar dos veces la misma orden y quedar con el stock movido sin la orden cerrada. Chequeo: las dos pruebas citadas.
 */

export type DependenciasDeCierreDeOrdenWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeProduccion, "cerrarOrden">;
  consultas: () => Pick<ConsultasDeProduccion, "fichaDeOrden">;
  respuesta: DependenciasDeRespuesta;
}>;

export type RenglonParaCerrar = Readonly<{ nombre: string; esperado: string; unidadId: string }>;

/** Lo que dibuja el formulario de cierre: la orden y un renglón por ingrediente, con lo esperado como valor inicial. */
export type OrdenParaCerrar = Readonly<{
  id: string;
  numero: number;
  nombre: string;
  unidadId: string;
  cantidadEsperada: string;
  renglones: readonly RenglonParaCerrar[];
}>;

/** La orden abierta a cerrar. Una que no existe, no es de la empresa, está fuera del alcance o ya no está abierta sale como el genérico, sin decir cuál de los casos es. Es una LECTURA: no escribe ni audita. */
export function cargarLaOrdenParaCerrar(
  d: DependenciasDeCierreDeOrdenWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<OrdenParaCerrar>> {
  return accionDeProduccion(
    d.respuesta,
    crudo,
    entradaDeOrden,
    async (entrada) => {
      const ficha = await d.consultas().fichaDeOrden(contexto, entrada);
      if (!ficha.ok) return ficha;
      if (ficha.valor === null) return err("ORDEN_NO_ENCONTRADA" as const);
      if (ficha.valor.estado !== "ABIERTA") return err("ORDEN_YA_CERRADA" as const);
      return ok(ficha.valor);
    },
    (f): OrdenParaCerrar => ({
      id: f.ordenId,
      numero: f.numero,
      nombre: f.nombre,
      unidadId: f.unidadId,
      cantidadEsperada: f.cantidadEsperada,
      renglones: f.renglones.map((r) => ({
        nombre: r.nombre,
        esperado: r.esperado,
        unidadId: r.unidadId,
      })),
    }),
  );
}

export type CierreHecho = Readonly<{ ordenId: string; yaExistia: boolean }>;

const SIN_ORDEN = errorDeCodigo("PRODUCCION_ACCION_NO_PERMITIDA");

/** Cierra la orden con lo real que cargó la persona. Repetir con la misma clave devuelve el mismo cierre (`yaExistia`). */
export async function cerrarLaOrden(
  d: DependenciasDeCierreDeOrdenWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<CierreHecho>> {
  const leida = entradaDeCierreDeOrden(crudo);
  if (!leida.ok) return { ok: false, error: SIN_ORDEN };
  const e = leida.valor;
  try {
    const ficha = await d.consultas().fichaDeOrden(contexto, { ordenId: e.ordenId });
    const cierre = await (async () => {
      if (!ficha.ok) return ficha;
      if (ficha.valor === null) return err("ORDEN_NO_ENCONTRADA" as const);
      if (ficha.valor.renglones.length !== e.consumos.length) {
        return err("RENGLONES_INVALIDOS" as const);
      }
      return d.casosDeUso().cerrarOrden(contexto, {
        ordenId: ficha.valor.ordenId,
        clave: e.clave,
        obtenido: e.obtenido,
        unidadId: ficha.valor.unidadId,
        vence: e.vence,
        consumos: ficha.valor.renglones.map((r, i) => ({
          productoId: r.productoId,
          cantidadReal: e.consumos[i] ?? "0",
          unidadId: r.unidadId,
        })),
        ...(e.confirmar ? { confirmaciones: [CONTROL_DE_NEGATIVO] } : {}),
      });
    })();
    return aRespuesta(
      cierre.ok ? cierre : err(traducirErrorDeProduccion(cierre.error)),
      d.respuesta,
      (s): CierreHecho => ({ ordenId: e.ordenId, yaExistia: s.yaExistia }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
