import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { FORMA_DEL_IMPORTE } from "../dominio/forma-del-importe";
import { cuentaId, lineaId } from "../dominio/identificadores";
import type { ModoDeCopia } from "../persistencia/modelo-de-cuentas";
import { aJson, calcularLasLineas } from "./calculo";
import { exigirAlcance, exigirJornadaAbierta, exigirUuid } from "./comun";
import type { TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

type R<S> = Resultado<S, ErrorDeVentas>;

export type EntradaDeCopiarLinea = Readonly<{
  /** La línea que se traslada: ya está ANULADA (la anuló quien llama, con el motivo `TRASLADADA`, o con el real si es el resto de una anulación parcial). */
  lineaOrigenId: string;
  cuentaDestinoId: string;
  /** Lo manda quien llama (derivado de forma determinística en unir y dividir): es la idempotencia de la copia. */
  lineaNuevaId: string;
  /** Texto decimal exacto, múltiplo del paso congelado de la línea. */
  cantidad: string;
  modo: ModoDeCopia;
  /** Solo en `COMPARTIDA`: lo que le toca a esta cuenta del importe de la línea (texto con hasta 2 decimales). */
  importeFijo?: string | undefined;
  /** Si la copia descuenta stock; sin decir, hereda el de la origen (en un ítem compartido solo UNA copia lo hereda: E7 S2). */
  controlaStock?: boolean | undefined;
}>;

export type SalidaDeCopiarLinea = Readonly<{
  posicion: number;
  totalProvisorio: ImporteJson;
  yaExistia: boolean;
}>;

/**
 * `copiarLineaEnTx` (E7 X3): pasa una línea a otra cuenta ABIERTA de la misma sucursal (o a la misma, para el resto de un ítem anulado en parte) SIN
 * recotizar: copia los valores CONGELADOS (precio, alícuota, unidad, paso, foto de opciones; no mira el catálogo) con una posición nueva. No anula la
 * origen: la anuló quien llama ANTES (el `UPDATE … WHERE estado = 'VIGENTE'` es el árbitro de «se traslada una sola vez»: `LINEA_YA_MOVIDA`). La base
 * comprueba al confirmar (`copias_cuadran`) que lo congelado es idéntico y que las partes suman la origen. Idempotente por `lineaNuevaId`. El
 * permiso lo exige quien llama. Audita `LINEA_COPIADA`.
 */
export async function copiarLineaEnTx(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeCopiarLinea,
): Promise<R<SalidaDeCopiarLinea>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.lineaOrigenId, entrada.cuentaDestinoId, entrada.lineaNuevaId);
  if (!ids.ok) return ids;
  const cantidad = (() => {
    try {
      return ok(cantidadDesdeTexto(entrada.cantidad));
    } catch (error) {
      if (error instanceof ErrorDeValor) return err("CANTIDAD_INVALIDA" as const);
      throw error;
    }
  })();
  if (!cantidad.ok) return cantidad;
  if (
    entrada.importeFijo !== undefined &&
    (entrada.modo !== "COMPARTIDA" || !FORMA_DEL_IMPORTE.test(entrada.importeFijo))
  ) {
    return err("IMPORTE_INVALIDO");
  }
  if (entrada.modo === "COMPARTIDA" && entrada.importeFijo === undefined) {
    return err("IMPORTE_INVALIDO");
  }

  const origen = await tx.cuentas.obtenerLinea(empresaId, lineaId(entrada.lineaOrigenId));
  if (origen === null) return err("LINEA_NO_ENCONTRADA");
  const destino = await tx.cuentas.obtener(empresaId, cuentaId(entrada.cuentaDestinoId));
  if (destino === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, destino.sucursalId);
  if (!alcance.ok) return alcance;

  // Repetición: la misma copia (mismo id, misma origen, misma cuenta) devuelve lo hecho; con otro contenido no se pisa.
  const existente = await tx.cuentas.obtenerLinea(empresaId, lineaId(entrada.lineaNuevaId));
  if (existente !== null) {
    const copia = await tx.cuentas.copiaDe(empresaId, existente.id);
    const mismaCantidad =
      cantidadDesdeTexto(existente.cantidad).unidades === cantidad.valor.unidades;
    if (
      copia === null ||
      copia.lineaOrigenId !== origen.id ||
      copia.modo !== entrada.modo ||
      existente.cuentaId !== destino.id ||
      !mismaCantidad
    ) {
      return err("LINEA_ID_EN_USO");
    }
    const lineas = await tx.cuentas.lineasDeCuenta(empresaId, destino.id);
    return ok({
      posicion: existente.posicion,
      totalProvisorio: aJson(calcularLasLineas(lineas)),
      yaExistia: true,
    });
  }

  if (origen.estado !== "ANULADA") return err("LINEA_NO_ANULADA");
  const cuentaDeOrigen = await tx.cuentas.obtener(empresaId, origen.cuentaId);
  if (cuentaDeOrigen === null) throw new Error("la línea no tiene su cuenta");
  if (cuentaDeOrigen.sucursalId !== destino.sucursalId) return err("LINEA_DE_OTRA_SUCURSAL");
  const jornada = await exigirJornadaAbierta(tx, contexto, destino.sucursalId);
  if (!jornada.ok) return jornada;

  // La cantidad es del paso congelado de la línea (decisión 162) y nunca más que la origen.
  const paso = cantidadDesdeTexto(origen.pasoDeCantidad).unidades;
  const deLaOrigen = cantidadDesdeTexto(origen.cantidad).unidades;
  if (
    cantidad.valor.unidades <= 0n ||
    cantidad.valor.unidades > deLaOrigen ||
    cantidad.valor.unidades % paso !== 0n
  ) {
    return err("CANTIDAD_INVALIDA");
  }

  const posicion = await tx.cuentas.reservarPosicion(empresaId, destino.id);
  if (posicion === null) return err("CUENTA_NO_ABIERTA");
  const insertada = await tx.cuentas.insertarLinea(empresaId, {
    id: lineaId(entrada.lineaNuevaId),
    cuentaId: destino.id,
    posicion,
    productoId: origen.productoId,
    descripcion: origen.descripcion,
    nombreDeCocina: origen.nombreDeCocina,
    varianteOpcionId: origen.varianteOpcionId,
    varianteNombre: origen.varianteNombre,
    varianteVersionDeOpcionId: origen.varianteVersionDeOpcionId,
    precioId: origen.precioId,
    origenDelPrecio: origen.origenDelPrecio,
    precioBase: origen.precioBase,
    precioUnitario: origen.precioUnitario,
    cantidad: cantidadATexto(cantidad.valor),
    unidadDeVenta: origen.unidadDeVenta,
    pasoDeCantidad: origen.pasoDeCantidad,
    alicuota: origen.alicuota,
    // Una copia conserva lo congelado de la línea de origen (precio, alícuota y también el camino de clasificación): no se vuelve a leer del producto.
    clasificacion: origen.clasificacion,
    controlaStock: entrada.controlaStock ?? origen.controlaStock,
    importeFijo: entrada.importeFijo ?? null,
    creadaPor: persona,
    creadaEn: contexto.ahora,
    opciones: origen.opciones,
  });
  if (!insertada) return err("LINEA_ID_EN_USO");
  await tx.cuentas.insertarCopia(empresaId, {
    lineaNuevaId: lineaId(entrada.lineaNuevaId),
    lineaOrigenId: origen.id,
    modo: entrada.modo,
  });

  const lineas = await tx.cuentas.lineasDeCuenta(empresaId, destino.id);
  const calculado = calcularLasLineas(lineas);
  await tx.cuentas.fijarTotal(empresaId, destino.id, importeAJson(calculado.total).monto);
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "LINEA_COPIADA",
    entidad: "linea_cuenta",
    entidadId: entrada.lineaNuevaId,
    despues: {
      cuentaId: destino.id,
      posicion,
      lineaOrigenId: origen.id,
      modo: entrada.modo,
      cantidad: cantidadATexto(cantidad.valor),
      importeFijo: entrada.importeFijo ?? null,
      totalProvisorio: importeAJson(calculado.total).monto,
    },
  });
  return ok({ posicion, totalProvisorio: importeAJson(calculado.total), yaExistia: false });
}
