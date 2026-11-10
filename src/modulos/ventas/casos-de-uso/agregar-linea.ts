import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  cantidadATexto,
  cantidadDesdeTexto,
  type Cantidad,
} from "../../../primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import { precioDeVentaDesdeTexto } from "../../../primitivas/dinero/precio-de-venta";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { cotizarParaVender, type InstantaneaDeProducto } from "../../catalogo/publico";
import { comprobarCantidadDeLinea } from "../dominio/cantidad-de-linea";
import { confirmacionesDesdeTexto, decidirAgregarLinea } from "../dominio/decisiones";
import { cuentaId, lineaId } from "../dominio/identificadores";
import type { Linea, OpcionDeLinea } from "../persistencia/repositorio-de-cuentas";
import { aJson, calcularLasLineas } from "./calculo";
import {
  exigirAlcance,
  exigirJornadaAbierta,
  exigirUuid,
  prepararComando,
  traducir,
} from "./comun";
import type { DependenciasDeVentas, TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

type R<S> = Resultado<S, ErrorDeVentas>;

export type EntradaDeAgregarLinea = Readonly<{
  cuentaId: string;
  /** Lo manda la pantalla: es la clave de idempotencia de la línea. */
  lineaId: string;
  productoId: string;
  /** El tamaño elegido (la opción de la variante), si el producto la tiene. */
  varianteId?: string | undefined;
  opcionIds: readonly string[];
  /** Texto decimal exacto (`"1"`, `"0.5"`), nunca `number`. */
  cantidad: string;
  confirmaciones?: readonly string[] | undefined;
}>;

export type SalidaDeAgregarLinea = Readonly<{
  posicion: number;
  precioUnitario: ImporteJson;
  totalProvisorio: ImporteJson;
  yaExistia: boolean;
}>;

const ARS = "ARS";

/** Las opciones elegidas de la línea ya guardada, con la del tamaño, sin repetir y ordenadas: lo que la identifica. */
function eleccionDeLaLinea(linea: Linea): string[] {
  const elegidas = linea.opciones.map((o) => o.opcionId);
  return (
    linea.varianteOpcionId === null ? elegidas : [linea.varianteOpcionId, ...elegidas]
  ).sort();
}

function cantidadIgual(a: string, b: Cantidad): boolean {
  try {
    return cantidadDesdeTexto(a).unidades === b.unidades;
  } catch (error) {
    // Un valor guardado que no se lee no puede ser lo que se pide; cualquier otro fallo no se traga.
    if (error instanceof ErrorDeValor) return false;
    throw error;
  }
}

/**
 * `agregarLinea` (E4 §3.4). El precio sale del catálogo, nunca del cliente: se cotiza (`cotizarParaVender`) en la MISMA transacción con la
 * sucursal de la cuenta y el instante del contexto, y se congelan precio, cantidad, unidad y paso con la foto de las opciones. Orden:
 * guard (`cuentas.agregar_linea`), la empresa opera, la cuenta existe, la sucursal está en el alcance, la jornada está abierta y entonces
 * valida y escribe. `UPDATE cuenta_consumo SET ultima_posicion = ultima_posicion + 1 WHERE estado = 'ABIERTA'` reserva la posición y es el
 * árbitro contra otra alta y contra el cierre: o la línea entra al ticket, o recibe `CUENTA_NO_ABIERTA`; nunca una línea vigente fuera
 * del ticket. El `lineaId` lo manda la pantalla: repetir el pedido devuelve la misma posición (`yaExistia`); el mismo id con otro
 * contenido es `LINEA_ID_EN_USO`. Un precio en «precio abierto» (sin precio cargado) no se vende todavía: `PRODUCTO_SIN_PRECIO`. Una línea
 * a $0 pide la confirmación `VENTA_A_CERO`. Audita `LINEA_AGREGADA` en la misma transacción.
 */
async function agregar(
  tx: TxDeVentas,
  dependencias: DependenciasDeVentas,
  contexto: ContextoOperativo,
  entrada: EntradaDeAgregarLinea,
): Promise<R<SalidaDeAgregarLinea>> {
  const { empresaId } = contexto;
  const persona = await prepararComando(tx, contexto, dependencias.reglas, [
    "cuentas.agregar_linea",
  ]);
  if (!persona.ok) return persona;
  const ids = exigirUuid(
    entrada.cuentaId,
    entrada.lineaId,
    entrada.productoId,
    ...(entrada.varianteId === undefined ? [] : [entrada.varianteId]),
    ...entrada.opcionIds,
  );
  if (!ids.ok) return ids;

  const cuenta = await tx.cuentas.obtener(empresaId, cuentaId(entrada.cuentaId));
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  const jornada = await exigirJornadaAbierta(tx, contexto, cuenta.sucursalId);
  if (!jornada.ok) return jornada;

  const confirmaciones = confirmacionesDesdeTexto(entrada.confirmaciones);
  if (!confirmaciones.ok) return confirmaciones;
  const cantidad = (() => {
    try {
      return ok(cantidadDesdeTexto(entrada.cantidad));
    } catch (error) {
      if (error instanceof ErrorDeValor) return err("CANTIDAD_INVALIDA" as const);
      throw error;
    }
  })();
  if (!cantidad.ok) return cantidad;
  const dentroDeLaCota = comprobarCantidadDeLinea(cantidad.valor);
  if (!dentroDeLaCota.ok) return dentroDeLaCota;
  const elegidas = [
    ...(entrada.varianteId === undefined ? [] : [entrada.varianteId]),
    ...entrada.opcionIds,
  ];

  // Repetición: el mismo `lineaId` con el mismo contenido devuelve lo hecho; con otro contenido no se pisa.
  const existente = await tx.cuentas.obtenerLinea(empresaId, lineaId(entrada.lineaId));
  if (existente !== null) {
    const mismoContenido =
      existente.cuentaId === cuenta.id &&
      existente.productoId === entrada.productoId &&
      cantidadIgual(existente.cantidad, cantidad.valor) &&
      JSON.stringify(eleccionDeLaLinea(existente)) === JSON.stringify([...elegidas].sort());
    if (!mismoContenido) return err("LINEA_ID_EN_USO");
    const lineas = await tx.cuentas.lineasDeCuenta(empresaId, cuenta.id);
    return ok({
      posicion: existente.posicion,
      precioUnitario: { moneda: ARS, monto: existente.precioUnitario },
      totalProvisorio: aJson(calcularLasLineas(lineas)),
      yaExistia: true,
    });
  }

  const cotizacion = await cotizarParaVender(tx, {
    empresaId,
    sucursalId: cuenta.sucursalId,
    productoId: entrada.productoId,
    opcionIds: elegidas,
    cantidad: cantidadATexto(cantidad.valor),
    ahora: contexto.ahora,
  });
  if (!cotizacion.ok) return cotizacion;
  const instantanea: InstantaneaDeProducto = cotizacion.valor;
  if (
    instantanea.precioUnitario === null ||
    instantanea.precioBase === null ||
    instantanea.precioId === null ||
    instantanea.origenDelPrecio === "ABIERTO"
  ) {
    return err("PRODUCTO_SIN_PRECIO");
  }
  const precioUnitario = precioDeVentaDesdeTexto(instantanea.precioUnitario);
  if (!precioUnitario.ok)
    throw new Error("el catálogo devolvió un precio que no es un importe exacto");
  const decision = decidirAgregarLinea({
    estadoDeLaCuenta: cuenta.estado,
    precioUnitario: precioUnitario.valor,
    confirmaciones: confirmaciones.valor,
  });
  if (!decision.ok) return decision;

  const posicion = await tx.cuentas.reservarPosicion(empresaId, cuenta.id);
  if (posicion === null) return err("CUENTA_NO_ABIERTA");
  const opciones: OpcionDeLinea[] = instantanea.opciones.map((o, i) => ({
    orden: i + 1,
    opcionId: o.opcionId,
    versionDeOpcionId: o.versionDeOpcionId,
    grupoId: o.grupoId,
    nombreDeGrupo: o.nombreDeGrupo,
    nombre: o.nombre,
    clase: o.clase,
    recargo: o.recargo,
    origenDelRecargo: o.origenDelRecargo,
  }));
  const insertada = await tx.cuentas.insertarLinea(empresaId, {
    id: lineaId(entrada.lineaId),
    cuentaId: cuenta.id,
    posicion,
    productoId: instantanea.productoId,
    descripcion: instantanea.descripcion,
    varianteOpcionId: instantanea.variante === null ? null : instantanea.variante.opcionId,
    varianteNombre: instantanea.variante === null ? null : instantanea.variante.nombre,
    precioId: instantanea.precioId,
    origenDelPrecio: instantanea.origenDelPrecio,
    precioBase: instantanea.precioBase,
    precioUnitario: precioUnitarioATexto(precioUnitario.valor),
    cantidad: cantidadATexto(cantidad.valor),
    unidadDeVenta: instantanea.unidadDeVentaId,
    pasoDeCantidad: instantanea.pasoMinimo,
    alicuota: instantanea.alicuota,
    // El stock está apagado en E4 (decisión 132): ninguna línea controla stock mientras el módulo no esté activo.
    controlaStock: false,
    creadaPor: persona.valor,
    creadaEn: contexto.ahora,
    opciones,
  });
  if (!insertada) return err("LINEA_ID_EN_USO");

  const lineas = await tx.cuentas.lineasDeCuenta(empresaId, cuenta.id);
  const calculado = calcularLasLineas(lineas);
  await tx.cuentas.fijarTotal(empresaId, cuenta.id, importeAJson(calculado.total).monto);
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona.valor,
    accion: "LINEA_AGREGADA",
    entidad: "linea_cuenta",
    entidadId: entrada.lineaId,
    despues: {
      cuentaId: cuenta.id,
      posicion,
      productoId: instantanea.productoId,
      descripcion: instantanea.descripcion,
      cantidad: cantidadATexto(cantidad.valor),
      precioUnitario: precioUnitarioATexto(precioUnitario.valor),
      totalProvisorio: importeAJson(calculado.total).monto,
    },
  });
  return ok({
    posicion,
    precioUnitario: { moneda: ARS, monto: precioUnitarioATexto(precioUnitario.valor) },
    totalProvisorio: importeAJson(calculado.total),
    yaExistia: false,
  });
}

export function armarAgregarLinea(dependencias: DependenciasDeVentas) {
  return async function agregarLinea(
    contexto: ContextoOperativo,
    entrada: EntradaDeAgregarLinea,
  ): Promise<R<SalidaDeAgregarLinea>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      agregar(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}
