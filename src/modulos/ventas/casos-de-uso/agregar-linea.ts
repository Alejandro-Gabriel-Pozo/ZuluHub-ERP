import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import {
  cantidadATexto,
  cantidadDesdeTexto,
  type Cantidad,
} from "../../../primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import {
  precioUnitarioATexto,
  precioUnitarioDesdeTexto,
} from "../../../primitivas/dinero/precio-unitario";
import { precioDeVentaDesdeTexto } from "../../../primitivas/dinero/precio-de-venta";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { cotizarParaVender, type InstantaneaDeProducto } from "../../catalogo/publico";
import { comprobarCantidadDeLinea } from "../dominio/cantidad-de-linea";
import { confirmacionesDesdeTexto, decidirAgregarLinea } from "../dominio/decisiones";
import { decidirPrecioDeLaLinea, importeDePrecioAbierto } from "../dominio/precio-abierto";
import { cuentaId, lineaId } from "../dominio/identificadores";
import type { Linea, OpcionDeLinea } from "../persistencia/repositorio-de-cuentas";
import { aJson, calcularLasLineas } from "./calculo";
import {
  exigirAlcance,
  exigirJornadaAbierta,
  type OpcionesDeLaVenta,
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
  /**
   * Solo para un producto en «precio abierto» (sin precio cargado; decisiones 169 y 179): el importe que escribe quien vende, texto decimal
   * con hasta 2 decimales. Con precio de catálogo se rechaza (`PRECIO_ABIERTO_NO_PERMITIDO`): el servidor manda.
   */
  precioAbierto?: string | undefined;
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

/** Una línea ya guardada con precio abierto repite solo con el mismo importe; una de catálogo, sin importe escrito. */
function mismoPrecioAbierto(linea: Linea, precioAbierto: string | undefined): boolean {
  if (linea.origenDelPrecio !== "ABIERTO") return precioAbierto === undefined;
  if (precioAbierto === undefined) return false;
  const pedido = importeDePrecioAbierto(precioAbierto);
  return (
    pedido.ok &&
    precioUnitarioATexto(pedido.valor) ===
      precioUnitarioATexto(precioUnitarioDesdeTexto(linea.precioUnitario))
  );
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
 * contenido es `LINEA_ID_EN_USO`. Un producto en «precio abierto» (sin precio cargado) se vende con el importe que escribe quien vende (`precioAbierto`, decisión 179); sin él, `PRODUCTO_SIN_PRECIO`; con precio de catálogo, un importe del cliente se rechaza. Una línea
 * a $0 pide la confirmación `VENTA_A_CERO`. Audita `LINEA_AGREGADA` en la misma transacción. Sella además la versión de la opción de la
 * variante (el factor de tamaño del consumo de stock) y si la línea descuenta stock (`controla_stock`, lo dice el puerto de stock: sin él, no).
 */
export async function agregarLineaEnTx(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeAgregarLinea,
  ventaOpciones: OpcionesDeLaVenta = {},
): Promise<R<SalidaDeAgregarLinea>> {
  const { empresaId } = contexto;
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
  const jornada = await exigirJornadaAbierta(
    tx,
    contexto,
    cuenta.sucursalId,
    ventaOpciones.jornada,
  );
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
      JSON.stringify(eleccionDeLaLinea(existente)) === JSON.stringify([...elegidas].sort()) &&
      mismoPrecioAbierto(existente, entrada.precioAbierto);
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
  const cotizado =
    instantanea.precioUnitario === null
      ? null
      : precioDeVentaDesdeTexto(instantanea.precioUnitario);
  if (cotizado !== null && !cotizado.ok) {
    throw new Error("el catálogo devolvió un precio que no es un importe exacto");
  }
  const precio = decidirPrecioDeLaLinea({
    precioCotizado: cotizado === null ? null : cotizado.valor,
    precioAbierto: entrada.precioAbierto,
  });
  if (!precio.ok) return precio;
  const precioUnitario = precio.valor.precioUnitario;
  const esAbierto = precio.valor.origen === "ABIERTO";
  const decision = decidirAgregarLinea({
    estadoDeLaCuenta: cuenta.estado,
    precioUnitario,
    confirmaciones: confirmaciones.valor,
  });
  if (!decision.ok) return decision;

  // Qué líneas descuentan stock lo dice stock (con el módulo apagado, ninguna; sin puerto cableado, tampoco): se sella en la línea y el cierre
  // solo manda esas (E4 §3.10; D132).
  const controlaStock =
    ventaOpciones.stock === undefined
      ? false
      : (await ventaOpciones.stock.controla(tx, contexto, [instantanea.productoId])).get(
          instantanea.productoId,
        )?.controla === true;

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
    // La versión del tamaño que se vendió: de ella sale el factor del consumo de stock aunque después cambie la vigente (0036).
    varianteVersionDeOpcionId:
      instantanea.variante === null ? null : instantanea.variante.versionDeOpcionId,
    precioId: esAbierto ? null : instantanea.precioId,
    origenDelPrecio: esAbierto
      ? "ABIERTO"
      : instantanea.origenDelPrecio === "ABIERTO"
        ? "EMPRESA"
        : instantanea.origenDelPrecio,
    precioBase: esAbierto
      ? precioUnitarioATexto(precioUnitario)
      : (instantanea.precioBase ?? precioUnitarioATexto(precioUnitario)),
    precioUnitario: precioUnitarioATexto(precioUnitario),
    cantidad: cantidadATexto(cantidad.valor),
    unidadDeVenta: instantanea.unidadDeVentaId,
    pasoDeCantidad: instantanea.pasoMinimo,
    alicuota: instantanea.alicuota,
    controlaStock,
    creadaPor: persona,
    creadaEn: contexto.ahora,
    opciones,
  });
  if (!insertada) return err("LINEA_ID_EN_USO");

  const lineas = await tx.cuentas.lineasDeCuenta(empresaId, cuenta.id);
  const calculado = calcularLasLineas(lineas);
  await tx.cuentas.fijarTotal(empresaId, cuenta.id, importeAJson(calculado.total).monto);
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "LINEA_AGREGADA",
    entidad: "linea_cuenta",
    entidadId: entrada.lineaId,
    despues: {
      cuentaId: cuenta.id,
      posicion,
      productoId: instantanea.productoId,
      descripcion: instantanea.descripcion,
      cantidad: cantidadATexto(cantidad.valor),
      precioUnitario: precioUnitarioATexto(precioUnitario),
      origenDelPrecio: esAbierto ? "ABIERTO" : "CATALOGO",
      totalProvisorio: importeAJson(calculado.total).monto,
    },
  });
  return ok({
    posicion,
    precioUnitario: { moneda: ARS, monto: precioUnitarioATexto(precioUnitario) },
    totalProvisorio: importeAJson(calculado.total),
    yaExistia: false,
  });
}

async function agregar(
  tx: TxDeVentas,
  dependencias: DependenciasDeVentas,
  contexto: ContextoOperativo,
  entrada: EntradaDeAgregarLinea,
): Promise<R<SalidaDeAgregarLinea>> {
  const persona = await prepararComando(tx, contexto, dependencias.reglas, [
    "cuentas.agregar_linea",
  ]);
  if (!persona.ok) return persona;
  return agregarLineaEnTx(tx, contexto, persona.valor, entrada, { stock: dependencias.stock });
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
