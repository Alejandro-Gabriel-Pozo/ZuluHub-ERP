import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { EstadoDeFacturaSeparada } from "../modulos/compras/publico";
import { err, ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeAnularConciliacion,
  entradaDeConciliarFactura,
  entradaDeFichaDeFactura,
  entradaDeListarFacturas,
  entradaDeRegistrarFactura,
  entradaDeTomarElCosto,
} from "./entradas-de-facturas";
import { accionDeCompras } from "./errores-de-compras";
import type { Web } from "./web";

/**
 * Las pantallas de «Facturas» (Compras 4, la factura de la empresa y su conciliación con lo recibido por sucursal): la lista, el detalle, los datos de «Conciliar», «Cargar factura», «Confirmar conciliación» y «Anular
 * conciliación». Cada una es una LECTURA (no escribe ni audita) o un caso de uso del módulo, que ya trae su permiso, su alcance de sucursal, su idempotencia y su transacción (`registrarFactura`, `conciliarFactura`,
 * `anularConciliacion`). Acá solo se arma el pedido:
 *  - **La empresa y la persona salen del contexto.** La factura NO tiene sucursal: es de la empresa; lo que se concilia sí (cada recepción es de una sucursal) y lo decide el servidor con el alcance de quien pide.
 *  - Todo sale campo por campo (lista de permitidos). Los ids de persona NO salen.
 *  - Los errores de negocio salen como el genérico (`errores-de-compras.ts`).
 * Previene: una factura o una conciliación repetida por doble toque o reintento, y una conciliación con la empresa o la sucursal que diga el navegador. Chequeo: `test/integracion/compras-facturas-web.test.ts`.
 */

export type DependenciasDeFacturasWeb = Readonly<{
  consultas: () => Pick<
    ReturnType<Web["consultasDeCompras"]>,
    | "listarFacturasSeparadas"
    | "fichaDeFacturaSeparada"
    | "conciliacionesDeFactura"
    | "proponerConciliacion"
  >;
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCompras"]>,
    "registrarFactura" | "conciliarFactura" | "anularConciliacion" | "tomarElCosto"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

export type ListaDeFacturasParaLaPantalla = Readonly<{
  facturas: readonly Readonly<{
    comprobanteId: string;
    /** El nombre del proveedor; `null` si no se puede mostrar (parte anonimizada). */
    proveedor: string | null;
    tipo: string | null;
    puntoDeVenta: number | null;
    numero: number | null;
    fechaNegocio: string;
    totalSegunFactura: string;
    estado: EstadoDeFacturaSeparada;
  }>[];
  /** El cursor de la página que sigue; `null` en la última. */
  siguiente: string | null;
}>;

/** Las facturas de la empresa, de la más nueva a la más vieja. Sin filtros en la primera versión (decisión del dueño, 25/11/2026, pregunta 8). */
export function listarLasFacturas(
  d: DependenciasDeFacturasWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ListaDeFacturasParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeListarFacturas,
    (entrada) =>
      d.consultas().listarFacturasSeparadas(contexto, {
        ...(entrada.despuesDe === null ? {} : { despuesDe: entrada.despuesDe }),
      }),
    (pagina) => ({
      facturas: pagina.filas.map((f) => ({
        comprobanteId: f.comprobanteId,
        proveedor: f.proveedorNombre,
        tipo: f.tipo,
        puntoDeVenta: f.puntoDeVenta,
        numero: f.numero,
        fechaNegocio: f.fechaNegocio,
        totalSegunFactura: f.totalSegunFactura,
        estado: f.estado,
      })),
      siguiente: pagina.siguiente,
    }),
  );
}

export type FichaDeFacturaParaLaPantalla = Readonly<{
  comprobanteId: string;
  proveedor: string | null;
  tipo: string | null;
  puntoDeVenta: number | null;
  numero: number | null;
  fechaNegocio: string;
  totalSegunFactura: string;
  estado: EstadoDeFacturaSeparada;
  lineas: readonly Readonly<{
    numero: number;
    producto: string | null;
    unidadDeStockId: string | null;
    facturada: string;
    conciliada: string;
    recibidoPorSucursal: readonly Readonly<{
      sucursalId: string;
      recibida: string;
      sinConciliar: string;
    }>[];
    /** Las líneas recibidas que esta línea cubre entera y sola, con su costo: se puede tomar o ya se tomó. */
    costos: readonly Readonly<{
      recepcionId: string;
      recepcionNumero: number;
      linea: number;
      sucursalId: string;
      recibida: string;
      estado: "SE_PUEDE_TOMAR" | "TOMADO";
      precioNeto: string;
    }>[];
  }>[];
}>;

export type ConciliacionParaLaPantalla = Readonly<{
  conciliacionId: string;
  fechaNegocio: string;
  anulada: boolean;
  /** Quien mira tiene alcance sobre TODAS las sucursales que repartió esta conciliación: solo entonces puede anularla. */
  anulableEnAlcance: boolean;
  asignaciones: readonly Readonly<{
    lineaDeFactura: number;
    recepcionNumero: number;
    sucursalId: string;
    lineaDeRecepcion: number;
    cantidad: string;
  }>[];
}>;

/** El detalle de una factura de la empresa; una que no existe, es de otra empresa o no es de recepción separada es indistinguible. */
export function fichaDeLaFactura(
  d: DependenciasDeFacturasWeb,
  contexto: ContextoOperativo,
  comprobanteId: string,
): Promise<Respuesta<FichaDeFacturaParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    { comprobanteId },
    entradaDeFichaDeFactura,
    async (entrada) => {
      const ficha = await d.consultas().fichaDeFacturaSeparada(contexto, entrada);
      if (!ficha.ok) return ficha;
      if (ficha.valor === null) return err("COMPROBANTE_NO_ENCONTRADO");
      return ok(ficha.valor);
    },
    (f) => ({
      comprobanteId: f.comprobanteId,
      proveedor: f.proveedorNombre,
      tipo: f.tipo,
      puntoDeVenta: f.puntoDeVenta,
      numero: f.numero,
      fechaNegocio: f.fechaNegocio,
      totalSegunFactura: f.totalSegunFactura,
      estado: f.estado,
      lineas: f.lineas.map((l) => ({
        numero: l.numero,
        producto: l.productoNombre,
        unidadDeStockId: l.unidadDeStockId,
        facturada: l.facturada,
        conciliada: l.conciliada,
        recibidoPorSucursal: l.recibidoPorSucursal.map((r) => ({ ...r })),
        costos: l.costos.map((k) => ({ ...k })),
      })),
    }),
  );
}

/**
 * Las conciliaciones hechas de una factura de la empresa (guard `conciliaciones.ver`: el operador no las ve y la consulta lo rechaza), solo las que repartieron alguna sucursal del alcance de quien pide y, de cada una,
 * solo lo de esas sucursales. Una factura que no existe o es de otra empresa es indistinguible.
 */
export function conciliacionesDeLaFactura(
  d: DependenciasDeFacturasWeb,
  contexto: ContextoOperativo,
  comprobanteId: string,
): Promise<Respuesta<readonly ConciliacionParaLaPantalla[]>> {
  return accionDeCompras(
    d.respuesta,
    { comprobanteId },
    entradaDeFichaDeFactura,
    async (entrada) => {
      const hechas = await d.consultas().conciliacionesDeFactura(contexto, entrada);
      if (!hechas.ok) return hechas;
      if (hechas.valor === null) return err("COMPROBANTE_NO_ENCONTRADO");
      return ok(hechas.valor);
    },
    (hechas) =>
      hechas.map((c) => ({
        conciliacionId: c.conciliacionId,
        fechaNegocio: c.fechaNegocio,
        anulada: c.anulada,
        anulableEnAlcance: c.anulableEnAlcance,
        asignaciones: c.asignaciones.map((a) => ({ ...a })),
      })),
  );
}

export type DatosParaConciliarParaLaPantalla = Readonly<{
  /** Lo que la factura tiene todavía sin conciliar, por línea. */
  lineas: readonly Readonly<{
    numero: number;
    producto: string | null;
    unidadDeStockId: string | null;
    facturada: string;
    sinConciliar: string;
  }>[];
  /** Lo recibido y todavía sin asignar de las sucursales del alcance de quien pide, con su producto. */
  recibidas: readonly Readonly<{
    recepcionId: string;
    recepcionNumero: number;
    sucursalId: string;
    linea: number;
    productoId: string;
    producto: string | null;
    unidadDeStockId: string | null;
    recibida: string;
    sinAsignar: string;
  }>[];
  /** La propuesta de un toque: se puede dejar tal cual o corregir. */
  propuesta: readonly Readonly<{
    lineaDeFactura: number;
    recepcionId: string;
    lineaDeRecepcion: number;
    cantidad: string;
  }>[];
  /** El producto de cada línea de la factura (para saber con qué línea recibida se puede repartir). */
  productosDeLasLineas: readonly Readonly<{ numero: number; productoId: string }>[];
}>;

/** Lo que necesita «Conciliar» y la propuesta, limitadas al alcance de quien pide (hoy gerente y administrador tienen «TODAS», H6). */
export function datosParaConciliar(
  d: DependenciasDeFacturasWeb,
  contexto: ContextoOperativo,
  comprobanteId: string,
): Promise<Respuesta<DatosParaConciliarParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    { comprobanteId },
    entradaDeFichaDeFactura,
    async (entrada) => {
      const propuesta = await d.consultas().proponerConciliacion(contexto, entrada);
      if (!propuesta.ok) return propuesta;
      if (propuesta.valor === null) return err("COMPROBANTE_NO_ENCONTRADO");
      return ok(propuesta.valor);
    },
    (p) => ({
      lineas: p.lineas.map((l) => ({
        numero: l.numero,
        producto: l.productoNombre,
        unidadDeStockId: l.unidadDeStockId,
        facturada: l.facturada,
        sinConciliar: l.sinConciliar,
      })),
      recibidas: p.recibidas.map((r) => ({
        recepcionId: r.recepcionId,
        recepcionNumero: r.recepcionNumero,
        sucursalId: r.sucursalId,
        linea: r.linea,
        productoId: r.productoId,
        producto: r.productoNombre,
        unidadDeStockId: r.unidadDeStockId,
        recibida: r.recibida,
        sinAsignar: r.sinAsignar,
      })),
      propuesta: p.asignaciones.map((a) => ({
        lineaDeFactura: a.lineaDeFactura,
        recepcionId: a.recepcionId,
        lineaDeRecepcion: a.lineaDeRecepcion,
        cantidad: a.cantidad,
      })),
      productosDeLasLineas: p.lineas.map((l) => ({ numero: l.numero, productoId: l.productoId })),
    }),
  );
}

export type FacturaRegistradaParaLaPantalla = Readonly<{
  comprobanteId: string;
  /** `true`: era la misma factura de un envío anterior (doble toque, reintento): no se escribió ni se auditó nada de nuevo. */
  yaExistia: boolean;
}>;

/**
 * «Cargar factura»: registra la factura de la empresa con `registrarFactura`, una transacción que ya trae la idempotencia (la misma clave con el mismo contenido devuelve la factura hecha; la misma factura del mismo
 * proveedor con otra clave se rechaza). **No toca stock ni sucursal.** El permiso (`comprobantes_de_proveedor.registrar`), la perilla del plan, las cuentas y el CUIT los decide el caso de uso adentro.
 */
export function registrarLaFactura(
  d: DependenciasDeFacturasWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<FacturaRegistradaParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeRegistrarFactura,
    (entrada) =>
      d.casosDeUso().registrarFactura(contexto, {
        clave: entrada.clave,
        proveedorId: entrada.proveedorId,
        factura: entrada.factura,
      }),
    (salida) => ({ comprobanteId: salida.comprobanteId, yaExistia: salida.yaExistia }),
  );
}

export type FacturaConciliadaParaLaPantalla = Readonly<{
  conciliacionId: string;
  /** `true`: era la misma conciliación de un envío anterior (doble toque, reintento): no se escribió ni se auditó nada de nuevo. */
  yaExistia: boolean;
}>;

/**
 * «Confirmar conciliación»: guarda todo o nada con `conciliarFactura`. Solo gerente o administrador (`conciliaciones.conciliar`) y con alcance sobre cada sucursal que se reparte; los topes (no más de lo recibido
 * ni de lo facturado) los impone la base: dos personas conciliando lo mismo a la vez, gana una. Tocar dos veces deja una sola.
 */
export function conciliarLaFactura(
  d: DependenciasDeFacturasWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<FacturaConciliadaParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeConciliarFactura,
    (entrada) => d.casosDeUso().conciliarFactura(contexto, entrada),
    (salida) => ({ conciliacionId: salida.conciliacionId, yaExistia: salida.yaExistia }),
  );
}

/** «Anular conciliación»: el espejo, una sola vez; las líneas recuperan su saldo y nada se borra. Solo gerente o administrador (`conciliaciones.anular`) con alcance sobre cada sucursal que repartió. */
export function anularLaConciliacion(
  d: DependenciasDeFacturasWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ anulada: true }>>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeAnularConciliacion,
    (entrada) => d.casosDeUso().anularConciliacion(contexto, entrada),
    () => ({ anulada: true as const }),
  );
}

export type CostoTomadoParaLaPantalla = Readonly<{
  recepcionId: string;
  linea: number;
  /** `true`: era el mismo envío de un toque anterior (doble toque, reintento): no se escribió, ni se ajustó el stock, ni se auditó nada de nuevo. */
  yaExistia: boolean;
}>;

/**
 * «Tomar el costo de la factura»: toma el precio neto de la línea de la factura que cubre toda la línea recibida y completa su costo (`tomarElCosto`, una transacción: la corrección del precio, el
 * ajuste del promedio del stock y la auditoría). Solo gerente o administrador (`compras.corregir` y `stock.ajustar`) con alcance sobre la sucursal de la recepción. El pedido lleva solo la clave del
 * envío, la recepción y la línea: el precio y el motivo los decide el servidor. Tocar dos veces deja una; todo rechazo sale como el genérico.
 */
export function tomarElCostoDeLaFactura(
  d: DependenciasDeFacturasWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<CostoTomadoParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeTomarElCosto,
    (entrada) => d.casosDeUso().tomarElCosto(contexto, entrada),
    (salida) => ({
      recepcionId: salida.recepcionId,
      linea: salida.linea,
      yaExistia: salida.yaExistia,
    }),
  );
}
