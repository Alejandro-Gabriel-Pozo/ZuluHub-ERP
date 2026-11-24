import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { vendeLaClase } from "../modulos/catalogo/publico";
import { err } from "../primitivas/resultado/resultado";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { identificador } from "./entradas-de-facturacion";
import { leerElPedidoDeConsumo } from "./entradas-de-consumo";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";
import type { Web } from "./web";

/**
 * Lo que consume cada opción de un grupo (A13, tramo Consumo; maqueta aprobada `productos.html`, función `vConsumo`, «Qué consume»): ver las líneas «Insumo · Cantidad · Escala con la medida»
 * de cada opción y guardarlas. Es SOLO DATO: no descuenta nada (eso lo hace el stock al vender). Vive acá, y no en `apps/web`, para probarse con la base real (igual que las opciones).
 *
 * Reglas (cada una con su prueba en `test/integracion/consumo-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta**: ver exige `productos.ver`; guardar, `opciones.editar` con alcance sobre todas las sucursales.
 *  - **Dos pestañas no se pisan**: el pedido lleva la versión de las opciones que se vio; con otra, rechaza sin escribir. Cada cambio de una opción sella una versión NUEVA de la opción (lo que ya
 *    se vendió no cambia nunca) y el caso de uso audita en la misma transacción.
 *  - **Repetir no duplica**: guardar el mismo consumo no escribe, no audita y no sube la versión (aunque la versión sea vieja). Es el conjunto FINAL de cada opción: lo que no figura se quita.
 *  - **Lo que se puede consumir** lo decide el caso de uso (materia prima, insumo, reventa o elaborado activos de la empresa, distintos del producto, sin repetir); la escala con la medida,
 *    solo si el producto tiene variante activa que es la medida. Acá no se repite ninguna de esas reglas.
 *  - **Nada de más sale**: el grupo, sus opciones activas con sus líneas y los insumos que se ofrecen (id, nombre y símbolo de la unidad); no el costo, el stock ni quién cargó cada cosa.
 */

export type DependenciasDeConsumoWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeCatalogo"]>, "guardarConsumoDeGrupo">;
  consultas: () => Pick<
    ReturnType<Web["consultasDeCatalogo"]>,
    "verProducto" | "productosParaConsumo" | "listarUnidades"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

export type LineaParaLaPantalla = Readonly<{
  insumoId: string;
  cantidad: string;
  escalaConTamano: boolean;
}>;

export type ConsumoParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  versionDeOpciones: number;
  grupo: Readonly<{ id: string; nombre: string }>;
  /** Si el producto tiene variante activa que es la medida: solo entonces una línea puede escalar con ella. */
  tieneMedida: boolean;
  opciones: readonly Readonly<{
    id: string;
    nombre: string;
    lineas: readonly LineaParaLaPantalla[];
  }>[];
  /** Lo que se puede consumir (hasta 100), con el símbolo de su unidad base; incluye lo que ya consume alguna línea aunque no figure entre los primeros. */
  insumos: readonly Readonly<{ id: string; nombre: string; unidad: string }>[];
}>;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

const conError = (error: unknown, respuesta: DependenciasDeRespuesta): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeCatalogo(error), respuesta),
});

/** Lo que consume cada opción activa de un grupo (no la variante) de un producto de la empresa. Es una LECTURA: no escribe ni audita. */
export async function verElConsumoDeUnGrupo(
  d: DependenciasDeConsumoWeb,
  contexto: ContextoOperativo,
  productoId: string,
  grupoId: string,
): Promise<Respuesta<ConsumoParaLaPantalla>> {
  if (!identificador.safeParse(productoId).success || !identificador.safeParse(grupoId).success)
    return { ok: false, error: GENERICO };
  try {
    const ficha = await d.consultas().verProducto(contexto, { productoId });
    if (!ficha.ok) return conError(ficha.error, d.respuesta);
    if (ficha.valor === null) return { ok: false, error: GENERICO };
    const { producto, grupos } = ficha.valor;
    if (!vendeLaClase(producto.claseDeUso)) return { ok: false, error: GENERICO };
    const grupo = grupos.find((g) => g.id === grupoId);
    // La variante no consume nada (el servidor lo rechaza igual): sale como un grupo que no está.
    if (grupo === undefined || !grupo.activo || grupo.clase === "VARIANTE")
      return { ok: false, error: GENERICO };
    const elegibles = await d.consultas().productosParaConsumo(contexto);
    if (!elegibles.ok) return conError(elegibles.error, d.respuesta);
    const unidades = await d.consultas().listarUnidades(contexto);
    if (!unidades.ok) return conError(unidades.error, d.respuesta);
    const simbolo = new Map(unidades.valor.map((u) => [u.id, u.simbolo]));
    const opciones = [...grupo.opciones]
      .filter((o) => o.activa)
      .sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id))
      .map((o) => ({
        id: o.id,
        nombre: o.nombre,
        lineas: o.consumo.map((l) => ({
          insumoId: l.insumoId,
          cantidad: l.cantidad,
          escalaConTamano: l.escalaConTamano,
        })),
      }));
    const insumos = elegibles.valor.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      unidad: simbolo.get(p.unidadBaseId) ?? "",
    }));
    return {
      ok: true,
      dato: {
        id: producto.id,
        nombre: producto.nombre,
        versionDeOpciones: producto.versionDeOpciones,
        grupo: { id: grupo.id, nombre: grupo.nombre },
        tieneMedida: grupos.some((g) => g.clase === "VARIANTE" && g.activo && g.esTamano),
        opciones,
        insumos,
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Guarda lo que consume cada opción del grupo; devuelve el id del producto. Ver las reglas arriba. */
export async function guardarElConsumoDeUnGrupo(
  d: DependenciasDeConsumoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ productoId: string }>>> {
  const leido = leerElPedidoDeConsumo(crudo);
  if (!leido.ok) return { ok: false, error: GENERICO };
  const pedido = leido.valor;
  try {
    const guardado = await d.casosDeUso().guardarConsumoDeGrupo(contexto, {
      productoId: pedido.productoId,
      versionDeOpcionesEsperada: pedido.versionDeOpciones,
      grupoId: pedido.grupoId,
      opciones: pedido.opciones,
    });
    return aRespuesta(
      guardado.ok ? guardado : err(traducirErrorDeCatalogo(guardado.error)),
      d.respuesta,
      () => ({ productoId: pedido.productoId }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
