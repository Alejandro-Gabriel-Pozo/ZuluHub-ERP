import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDeStock } from "./errores";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { err, ok } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import {
  explotarConsumo,
  type ConsumoDeOpcion,
  type LineaVendida,
  type OpcionElegida,
  type VarianteElegida,
} from "../dominio/explosion";
import { esUnidadConocida } from "../dominio/composicion";
import { huellaDeComando } from "../dominio/huella";
import { MOTIVO_DE_VENTA } from "../dominio/motivos";
import { ORIGEN_EJEMPLAR_DE_TICKET, type RenglonDeLibro } from "../dominio/movimiento";
import type { TxDeStock } from "./contrato";
import { buscarRepeticion, registrarMovimientoEnTx } from "./movimiento-en-tx";
import { MAXIMO_DE_RENGLONES, leerConfirmaciones, leerId, leerCantidad } from "./movimientos-comun";
import type {
  EntradaDeSalidaPorVenta,
  SalidaDeSalidaPorVenta,
  TxDeLecturaDeStock,
} from "./tipos-de-puertos";
import {
  estadoDelModuloDeStock,
  productosParaExplotar,
  soloUuids,
  unidadConocida,
} from "./lectura-de-venta";

type R<S> = Resultado<S, ErrorDeStock>;

// ---- la salida por venta -------------------------------------------------------------------------------------------------------

/** La clave de idempotencia de la salida de un ejemplar: derivada, no un UUID (nadie puede ocuparla a mano) y la misma en cada llamada. */
export const claveDeLaSalidaDeVenta = (ejemplarId: string): string => `venta_${ejemplarId}`;
/** La clave de la anulación espejo de la salida de un ejemplar. */
export const claveDeLaReversionDeVenta = (ejemplarId: string): string =>
  `anulacion_venta_${ejemplarId}`;

type LineaLeida = Readonly<{
  posicion: number;
  productoId: string;
  cantidad: ReturnType<typeof cantidadDesdeTexto>;
  unidadDeVentaId: ReturnType<typeof unidadConocida>;
  varianteId: string | null;
  opcionIds: readonly string[];
}>;

/**
 * Las líneas del ticket con su forma comprobada: 1 a `MAXIMO_DE_RENGLONES`, posición entera desde 1 sin repetir, producto y versiones UUID,
 * cantidad mayor que cero, unidad conocida y ninguna opción repetida en la línea. `RENGLONES_INVALIDOS` si la lista o una posición no sirve.
 */
function leerLineas(valor: unknown): R<readonly LineaLeida[]> {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > MAXIMO_DE_RENGLONES) {
    return err("RENGLONES_INVALIDOS");
  }
  const posiciones = new Set<number>();
  const lineas: LineaLeida[] = [];
  for (const crudo of valor as unknown[]) {
    const linea = (typeof crudo === "object" && crudo !== null ? crudo : {}) as Record<
      string,
      unknown
    >;
    const posicion = linea["posicion"];
    if (
      typeof posicion !== "number" ||
      !Number.isSafeInteger(posicion) ||
      posicion < 1 ||
      posiciones.has(posicion)
    ) {
      return err("RENGLONES_INVALIDOS");
    }
    posiciones.add(posicion);
    const productoId = leerId(linea["productoId"]);
    if (productoId === null) return err("PRODUCTO_NO_ENCONTRADO");
    const cantidad = leerCantidad(linea["cantidad"]);
    if (!cantidad.ok) return cantidad;
    const unidad = linea["unidadDeVentaId"];
    if (typeof unidad !== "string" || !esUnidadConocida(unidad)) {
      return err("IDENTIFICADOR_INVALIDO");
    }
    const varianteCruda = linea["varianteVersionDeOpcionId"];
    const varianteId =
      varianteCruda === undefined || varianteCruda === null ? null : leerId(varianteCruda);
    if (varianteCruda !== undefined && varianteCruda !== null && varianteId === null) {
      return err("VERSION_DE_OPCION_NO_ENCONTRADA");
    }
    const opciones = linea["opciones"];
    if (!Array.isArray(opciones)) return err("RENGLONES_INVALIDOS");
    const opcionIds: string[] = [];
    for (const opcion of opciones as unknown[]) {
      const id = leerId(
        typeof opcion === "object" && opcion !== null
          ? (opcion as Record<string, unknown>)["versionDeOpcionId"]
          : undefined,
      );
      if (id === null) return err("VERSION_DE_OPCION_NO_ENCONTRADA");
      opcionIds.push(id);
    }
    if (new Set(opcionIds).size !== opcionIds.length) return err("RENGLONES_INVALIDOS");
    lineas.push({
      posicion,
      productoId,
      cantidad: cantidad.valor,
      unidadDeVentaId: unidad,
      varianteId,
      opcionIds,
    });
  }
  return ok(lineas);
}

/** Lo que consumen las opciones y el factor de la variante, de las versiones SELLADAS de la venta; falla cerrado si una versión no existe. */
async function opcionesParaExplotar(
  tx: TxDeLecturaDeStock,
  contexto: Pick<ContextoOperativo, "empresaId">,
  lineas: readonly LineaLeida[],
): Promise<
  R<
    Readonly<{
      opciones: ReadonlyMap<string, OpcionElegida>;
      variantes: ReadonlyMap<string, VarianteElegida>;
      articulosDeInsumos: ReadonlyMap<
        string,
        Readonly<{
          articuloId: string;
          unidadDeStockId: ReturnType<typeof unidadConocida>;
          activo: boolean;
        }>
      >;
    }>
  >
> {
  const empresa = contexto.empresaId;
  const deOpciones = [...new Set(lineas.flatMap((l) => l.opcionIds))];
  const deVariantes = [
    ...new Set(lineas.flatMap((l) => (l.varianteId === null ? [] : [l.varianteId]))),
  ];
  const existentes = await tx.productosParaStock.factoresDeTamano(empresa, [
    ...deOpciones,
    ...deVariantes,
  ]);
  if ([...deOpciones, ...deVariantes].some((id) => !existentes.has(id))) {
    return err("VERSION_DE_OPCION_NO_ENCONTRADA");
  }
  const consumos = await tx.productosParaStock.consumoDeVersiones(empresa, deOpciones);
  const insumos = soloUuids([...consumos.values()].flatMap((l) => l.map((c) => c.insumoId)));
  const articulos = await tx.articulosDeStock.porProductos(empresa, insumos);
  const opciones = new Map<string, OpcionElegida>();
  for (const version of deOpciones) {
    const lineasDeConsumo: ConsumoDeOpcion[] = (consumos.get(version) ?? []).map((c) => ({
      insumoId: c.insumoId,
      cantidad: cantidadDesdeTexto(c.cantidad),
      escalaConTamano: c.escalaConTamano,
    }));
    opciones.set(version, { versionDeOpcionId: version, consumos: lineasDeConsumo });
  }
  const variantes = new Map<string, VarianteElegida>();
  for (const version of deVariantes) {
    variantes.set(version, {
      versionDeOpcionId: version,
      factorDeTamano: cantidadDesdeTexto(existentes.get(version) as string),
    });
  }
  return ok({
    opciones,
    variantes,
    articulosDeInsumos: new Map(
      articulos.map((a) => [
        a.productoId,
        { articuloId: a.id, unidadDeStockId: unidadConocida(a.unidadDeStockId), activo: a.activo },
      ]),
    ),
  });
}

/**
 * La salida de stock por una venta (E5 §3.3, `ConsumoDeStock.registrarSalidaPorVentaEnTx`). Corre en la transacción del llamador (el cierre de la
 * cuenta de ventas) y no autoriza: deja en `accion` la que puso ventas. La IDENTIDAD es el origen (el ejemplar del ticket): lo PRIMERO que hace
 * es buscar una salida de ese ejemplar y, si la hay, la devuelve con `yaExistia` aunque la receta haya cambiado entre las dos llamadas (el
 * primer hecho manda; la base lo impone con el único de origen aunque cambie la clave). Después explota cada línea con las versiones selladas
 * de lo vendido (`explotarConsumo`: una sola regla, pura), escribe UN movimiento `VENTA` con la `fecha_negocio` del ticket y devuelve las
 * excepciones `FALTA_RECETA` (la venta pasa, D140) y los avisos. Si ninguna línea descuenta no escribe nada (`movimientoId: null`). Un error de
 * acá (depósito, producto, unidad, control de existencia negativa) lo devuelve el llamador y revierte su transacción entera: ni número ni ticket.
 * Con el módulo apagado, en solo lectura o en desarrollo devuelve el motivo y no escribe (P20).
 */
export async function registrarSalidaPorVenta(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  entrada: EntradaDeSalidaPorVenta,
): Promise<R<SalidaDeSalidaPorVenta>> {
  const estado = await estadoDelModuloDeStock(tx, contexto, reglas);
  if (estado !== "ACTIVO") return err(estado);
  const origen = (typeof entrada.origen === "object" ? entrada.origen : null) as {
    tipo: unknown;
    id: unknown;
  } | null;
  const ejemplarId = leerId(origen?.id);
  if (origen === null || origen.tipo !== ORIGEN_EJEMPLAR_DE_TICKET || ejemplarId === null) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  const referencia = { tipo: ORIGEN_EJEMPLAR_DE_TICKET, id: ejemplarId } as const;
  const clave = claveDeLaSalidaDeVenta(ejemplarId);
  // La huella es la identidad del ejemplar: lo que se vendió no puede cambiar y lo que stock explotó no se vuelve a mirar.
  const huella = huellaDeComando("salida_por_venta", [ejemplarId], []);

  const repetido = await buscarRepeticion(tx, contexto, {
    clase: "SALIDA",
    clave,
    huella,
    origen: referencia,
  });
  if (!repetido.ok) return repetido;
  if (repetido.valor !== null) {
    return ok({ movimientoId: repetido.valor.id, yaExistia: true, excepciones: [], avisos: [] });
  }

  const confirmaciones = leerConfirmaciones(entrada.confirmaciones);
  if (!confirmaciones.ok) return confirmaciones;
  if (!(entrada.hechoEn instanceof Date) || Number.isNaN(entrada.hechoEn.getTime())) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  const fechaDeNegocio =
    typeof entrada.fechaDeNegocio === "string"
      ? fechaCivilDesdeTexto(entrada.fechaDeNegocio)
      : null;
  if (fechaDeNegocio === null || !fechaDeNegocio.ok) return err("IDENTIFICADOR_INVALIDO");
  const lineas = leerLineas(entrada.renglones);
  if (!lineas.ok) return lineas;
  const deposito = await cargarDepositoNormal(tx, contexto, entrada.depositoId);
  if (!deposito.ok) return deposito;

  const productos = await productosParaExplotar(
    tx,
    contexto,
    lineas.valor.map((l) => l.productoId),
  );
  if (lineas.valor.some((l) => !productos.has(l.productoId))) return err("PRODUCTO_NO_ENCONTRADO");
  const elegidas = await opcionesParaExplotar(tx, contexto, lineas.valor);
  if (!elegidas.ok) return elegidas;
  const aVender: LineaVendida[] = lineas.valor.map((l) => ({
    posicion: l.posicion,
    productoId: l.productoId,
    cantidad: l.cantidad,
    unidadDeVentaId: l.unidadDeVentaId,
    variante: l.varianteId === null ? null : (elegidas.valor.variantes.get(l.varianteId) ?? null),
    opciones: l.opcionIds.map((id) => elegidas.valor.opciones.get(id) as OpcionElegida),
  }));
  const explosion = explotarConsumo({
    lineas: aVender,
    productos,
    articulosDeInsumos: elegidas.valor.articulosDeInsumos,
  });
  if (!explosion.ok) {
    switch (explosion.error.codigo) {
      case "PRODUCTO_DESCONOCIDO":
        return err("PRODUCTO_NO_ENCONTRADO");
      case "FUERA_DE_RANGO":
        return err("CANTIDAD_INVALIDA");
      default:
        return err(explosion.error.codigo);
    }
  }

  const renglones: RenglonDeLibro[] = explosion.valor.renglones.map((r) => ({
    depositoId: deposito.valor.id,
    articuloId: r.articuloId,
    composicionId: r.composicionId,
    cantidad: r.cantidad,
  }));
  if (renglones.length === 0) {
    return ok({
      movimientoId: null,
      yaExistia: false,
      excepciones: explosion.valor.excepciones,
      avisos: explosion.valor.avisos,
    });
  }
  const registrado = await registrarMovimientoEnTx(tx, contexto, {
    clase: "SALIDA",
    motivo: MOTIVO_DE_VENTA,
    detalle: null,
    origen: referencia,
    depositoId: deposito.valor.id,
    accion: entrada.accion,
    anulaA: null,
    conteoId: null,
    clave,
    huella,
    hechoEn: entrada.hechoEn,
    fechaDeNegocio: fechaDeNegocio.valor,
    renglones,
    confirmaciones: confirmaciones.valor,
  });
  if (!registrado.ok) return registrado;
  if (registrado.valor.yaExistia) {
    return ok({
      movimientoId: registrado.valor.movimiento.id,
      yaExistia: true,
      excepciones: [],
      avisos: [],
    });
  }
  return ok({
    movimientoId: registrado.valor.movimiento.id,
    yaExistia: false,
    excepciones: explosion.valor.excepciones,
    avisos: [
      ...explosion.valor.avisos,
      ...registrado.valor.excepciones.map((negativa) => ({
        tipo: "EXISTENCIA_NEGATIVA" as const,
        ...negativa,
      })),
    ],
  });
}

/**
 * El depósito de un puerto: existe, está activo y es de uso normal (cuarentena y rechazo no venden ni reciben compras, P22). No mira el
 * alcance de sucursales: quien llama (ventas, compras) ya lo hizo con su propia acción.
 */
export async function cargarDepositoNormal(
  tx: Pick<TxDeStock, "depositos">,
  contexto: Pick<ContextoOperativo, "empresaId">,
  id: unknown,
) {
  const depositoId = leerId(id);
  if (depositoId === null) return err("DEPOSITO_NO_ENCONTRADO" as const);
  const deposito = await tx.depositos.obtener(contexto.empresaId, depositoId);
  if (deposito === null) return err("DEPOSITO_NO_ENCONTRADO" as const);
  if (!deposito.activo) return err("DEPOSITO_INACTIVO" as const);
  if (deposito.uso !== "NORMAL") return err("MOTIVO_NO_PERMITIDO" as const);
  return ok(deposito);
}
