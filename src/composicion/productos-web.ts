import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type {
  ClaseDeUso,
  EstadoDeProducto,
  PaginaDeProductos,
  PrecioDeLista,
} from "../modulos/catalogo/publico";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import {
  codificarLaPagina,
  leerLaEntradaDeLaLista,
  type EntradaDeLaLista,
} from "./entradas-de-productos";
import type { Web } from "./web";

/**
 * La lista de productos de la empresa (A1, T1; maqueta aprobada `productos.html`, 12/11/2026): solo lectura. Vive acá, y no en `apps/web`, para probarse con la base real sin
 * levantar Next (igual que `medios-de-pago-web.ts`).
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/productos-web.test.ts`):
 *  - **El permiso es de la consulta.** `listarProductos` exige `productos.ver` al guard dentro de su transacción: acá no se decide ningún permiso. Con `catalogo` en
 *    desarrollo (hoy) o sin el permiso sale el motivo del guard, sin dato alguno.
 *  - **La empresa y la persona las pone el servidor**: el pedido no las trae. Una empresa nunca ve productos de otra.
 *  - **Nada de más sale.** Lista blanca campo por campo: id, nombre, clase, estado y precio (el importe como texto decimal, ADR-006). Ni la unidad ni la versión ni la clave interna.
 *  - **Lo que nada puede coincidir no se pregunta**: una búsqueda, clase, estado o página inválidos devuelven una página vacía sin consultar (`entradas-de-productos.ts`).
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016): un fallo inesperado sale sin detalle y con referencia.
 * No aplican a una lectura: idempotencia, concurrencia, transacción de escritura ni auditoría (no cambia datos).
 */

export type DependenciasDeProductosWeb = Readonly<{
  consultas: () => Pick<ReturnType<Web["consultasDeCatalogo"]>, "listarProductos">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Lo que muestra la lista como precio. «SEGUN_TAMANO» es el nombre interno de «Según medida»; `importe` es texto decimal. */
export type PrecioParaLaPantalla =
  | Readonly<{ tipo: "EMPRESA"; importe: string }>
  | Readonly<{ tipo: "SEGUN_TAMANO" }>
  | Readonly<{ tipo: "SIN_PRECIO" }>;

/** Un producto para la pantalla; `precio: null` es un producto que no se vende. */
export type ProductoParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  claseDeUso: ClaseDeUso;
  estado: EstadoDeProducto;
  precio: PrecioParaLaPantalla | null;
}>;

export type ProductosParaLaPantalla = Readonly<{
  productos: readonly ProductoParaLaPantalla[];
  /** La clave de la página que sigue (`despues` en la dirección); `null` en la última. */
  siguiente: string | null;
}>;

function precioDe(precio: PrecioDeLista): PrecioParaLaPantalla | null {
  if (precio === null) return null;
  return precio.tipo === "EMPRESA"
    ? { tipo: "EMPRESA", importe: precio.precio }
    : { tipo: precio.tipo };
}

const paraLaPantalla = (pagina: PaginaDeProductos): ProductosParaLaPantalla => ({
  productos: pagina.productos.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    claseDeUso: p.claseDeUso,
    estado: p.estado,
    precio: precioDe(p.precio),
  })),
  siguiente: pagina.siguiente === null ? null : codificarLaPagina(pagina.siguiente),
});

/** Una página de los productos de la empresa (50), también los desactivados, con los filtros de la dirección. Es una LECTURA: no escribe ni audita. */
export async function listarLosProductos(
  d: DependenciasDeProductosWeb,
  contexto: ContextoOperativo,
  entrada: EntradaDeLaLista,
): Promise<Respuesta<ProductosParaLaPantalla>> {
  try {
    const leida = leerLaEntradaDeLaLista(entrada);
    if (leida === null) return { ok: true, dato: { productos: [], siguiente: null } };
    return aRespuesta(
      await d.consultas().listarProductos(contexto, leida),
      d.respuesta,
      paraLaPantalla,
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
