import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { UNIDADES } from "../../../primitivas/unidades/unidades";
import { esClaseDeUso, vendeLaClase, type ClaseDeUso } from "../dominio/clases";
import { esUnidad, formaDeVentaDelPiloto, validarFormaDeVenta } from "../dominio/forma-de-venta";
import { esUuid, productoId, type ProductoId } from "../dominio/identificadores";
import type { Producto } from "../dominio/modelo";
import { validarFicha, type EntradaDeFicha, type FichaValida } from "../dominio/producto";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo, TxDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeCrearProducto = Readonly<
  {
    /** El `id` lo manda la aplicación: es la clave de idempotencia del alta. */
    id: string;
    claseDeUso: string;
    unidadBaseId: string;
    /** Por defecto, la unidad base. */
    unidadDeVentaId?: string | undefined;
    /** Texto decimal exacto; por defecto `"1"`. */
    pasoMinimo?: string | undefined;
  } & EntradaDeFicha
>;

/** Alta rápida (decisión 131): solo el nombre, qué es y la unidad; queda «Falta completar» y no se vende hasta completarla. */
export type EntradaDeCrearProductoRapido = Readonly<{
  id: string;
  claseDeUso: string;
  nombre: string;
  unidadBaseId: string;
}>;

export type SalidaDeCrearProducto = Readonly<{ productoId: ProductoId; yaExistia: boolean }>;

/** ¿El producto ya guardado es lo que este pedido pediría? (mismo `id` y mismo contenido → repetición). */
function esLoMismo(
  guardado: Producto,
  clase: ClaseDeUso,
  ficha: FichaValida,
  forma: Readonly<{ unidadBaseId: string; unidadDeVentaId: string; paso: string }>,
  faltaCompletar: boolean,
): boolean {
  return (
    guardado.claseDeUso === clase &&
    guardado.nombre === ficha.nombre &&
    guardado.nombreDeCocina === ficha.nombreDeCocina &&
    guardado.descripcionEnCarta === ficha.descripcionEnCarta &&
    guardado.codigo === ficha.codigo &&
    guardado.codigoDeBarras === ficha.codigoDeBarras &&
    guardado.alicuota === ficha.alicuota &&
    guardado.seccionDeCartaId === ficha.seccionDeCartaId &&
    guardado.unidadBaseId === forma.unidadBaseId &&
    guardado.unidadDeVentaId === forma.unidadDeVentaId &&
    guardado.pasoMinimo === forma.paso &&
    guardado.faltaCompletar === faltaCompletar
  );
}

/**
 * El alta, común al alta completa y a la rápida. En una transacción serializable: el guard (`productos.crear`, alcance TODAS), la
 * empresa opera, y entonces valida clase, unidad, forma de venta y ficha. `INSERT … ON CONFLICT (id) DO NOTHING`: si el `id` ya existía,
 * mismo contenido → `yaExistia: true` sin escribir; otro contenido (o un id de otra empresa, que no se ve) → `ID_REUTILIZADO`. Un nombre,
 * código o código de barras repetido sale como error de unicidad (también contra los desactivados). Audita `PRODUCTO_CREADO` en la misma
 * transacción.
 */
async function crear(
  tx: TxDeCatalogo,
  dependencias: DependenciasDeCatalogo,
  contexto: ContextoOperativo,
  pedido: Readonly<{
    id: string;
    claseDeUso: string;
    unidadBaseId: string;
    unidadDeVentaId: string | undefined;
    pasoMinimo: string | undefined;
    ficha: EntradaDeFicha;
    rapida: boolean;
  }>,
): Promise<R<SalidaDeCrearProducto>> {
  const { empresaId } = contexto;
  const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.crear"]);
  if (!permiso.ok) return permiso;
  const alcance = await exigirAlcanceTotal(tx, contexto);
  if (!alcance.ok) return alcance;

  if (!esUuid(pedido.id)) return err("IDENTIFICADOR_INVALIDO");
  if (!esClaseDeUso(pedido.claseDeUso)) return err("CLASE_INVALIDA");
  const clase = pedido.claseDeUso;
  if (!esUnidad(pedido.unidadBaseId)) return err("UNIDAD_INVALIDA");
  const ficha = validarFicha(clase, pedido.ficha, !pedido.rapida);
  if (!ficha.ok) return ficha;

  const unidadDeVenta = pedido.unidadDeVentaId ?? pedido.unidadBaseId;
  const forma = validarFormaDeVenta(pedido.unidadBaseId, unidadDeVenta, pedido.pasoMinimo ?? "1");
  if (!forma.ok) {
    return err(forma.error === "UNIDAD_INVALIDA" ? "UNIDAD_INVALIDA" : "FORMA_DE_VENTA_INVALIDA");
  }
  const habilitada = dependencias.formaDeVentaHabilitada ?? formaDeVentaDelPiloto;
  if (!habilitada(pedido.unidadBaseId, forma.valor)) return err("FORMA_DE_VENTA_NO_SOPORTADA");

  const seccion = ficha.valor.seccionDeCartaId;
  if (seccion !== null) {
    const encontrada = await tx.productos.obtenerSeccion(empresaId, seccion);
    if (encontrada === null || !encontrada.activa) return err("SECCION_NO_ENCONTRADA");
  }

  const paso = cantidadATexto(forma.valor.pasoMinimo);
  const id = productoId(pedido.id);
  const insertado = await tx.productos.insertar(empresaId, {
    id,
    claseDeUso: clase,
    ficha: ficha.valor,
    unidadBaseId: pedido.unidadBaseId,
    dimension: UNIDADES[pedido.unidadBaseId].dimension,
    unidadDeVentaId: unidadDeVenta,
    pasoMinimo: paso,
    faltaCompletar: pedido.rapida,
    creadoPor: contexto.personaId,
  });
  if (!insertado) {
    const guardado = await tx.productos.obtener(empresaId, id);
    const igual =
      guardado !== null &&
      esLoMismo(
        guardado,
        clase,
        ficha.valor,
        { unidadBaseId: pedido.unidadBaseId, unidadDeVentaId: unidadDeVenta, paso },
        pedido.rapida,
      );
    return igual ? ok({ productoId: id, yaExistia: true }) : err("ID_REUTILIZADO");
  }
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: contexto.personaId,
    accion: "PRODUCTO_CREADO",
    entidad: "producto",
    entidadId: id,
    despues: {
      nombre: ficha.valor.nombre,
      claseDeUso: clase,
      unidadBaseId: pedido.unidadBaseId,
      unidadDeVentaId: unidadDeVenta,
      pasoMinimo: paso,
      alicuota: ficha.valor.alicuota,
      faltaCompletar: pedido.rapida,
      seVende: vendeLaClase(clase) && ficha.valor.alicuota !== null && !pedido.rapida,
    },
  });
  return ok({ productoId: id, yaExistia: false });
}

export function armarCrearProducto(dependencias: DependenciasDeCatalogo) {
  return async function crearProducto(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearProducto,
  ): Promise<R<SalidaDeCrearProducto>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      crear(tx, dependencias, contexto, {
        id: entrada.id,
        claseDeUso: entrada.claseDeUso,
        unidadBaseId: entrada.unidadBaseId,
        unidadDeVentaId: entrada.unidadDeVentaId,
        pasoMinimo: entrada.pasoMinimo,
        ficha: entrada,
        rapida: false,
      }),
    );
    return traducir(resultado);
  };
}

export function armarCrearProductoRapido(dependencias: DependenciasDeCatalogo) {
  return async function crearProductoRapido(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearProductoRapido,
  ): Promise<R<SalidaDeCrearProducto>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      crear(tx, dependencias, contexto, {
        id: entrada.id,
        claseDeUso: entrada.claseDeUso,
        unidadBaseId: entrada.unidadBaseId,
        unidadDeVentaId: undefined,
        pasoMinimo: undefined,
        ficha: { nombre: entrada.nombre },
        rapida: true,
      }),
    );
    return traducir(resultado);
  };
}
