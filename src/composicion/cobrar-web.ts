import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DatosDelCobro } from "../modulos/caja/publico";
import { ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeAnularElTicket,
  entradaDeCobrarLaVenta,
  entradaDeOpcionesDeCobro,
} from "./entradas-de-cobrar";
import { accionDeCobrar } from "./errores-de-cobrar";
import type { Web } from "./web";

/**
 * Las acciones de la web para COBRAR en el mostrador (K3), anular desde el resultado (K5) y las dos lecturas que la pantalla de cobro necesita (las cajas
 * con su sesión y las opciones de cobro de la caja). Vive acá (no en `apps/web`) para probarse con la base real sin levantar Next, igual que
 * `facturar-tickets-web.ts`. La acción del servidor resuelve el CONTEXTO (persona, empresa) y la SUCURSAL (la elegida, validada contra el alcance) y se
 * las pasa; del pedido solo viene lo que declara `entradas-de-cobrar.ts`. Cada caso de uso y consulta exige SU acción al guard adentro (`cuentas.abrir`,
 * `cuentas.agregar_linea`, `cuentas.cerrar` y `tickets.cobrar` para cobrar; `tickets.corregir` para anular; `ventas.ver` para leer). Todo sale con una
 * lista blanca campo por campo y los importes como texto decimal con moneda (ADR-006).
 *
 * Idempotencia: la clave, el id de la cuenta, el del ejemplar y los de las líneas los genera la pantalla UNA vez por intento de cobro y se repiten
 * tal cual en cada reintento (clic doble, corte de red): repetir devuelve lo hecho (`yaExistia`), sin duplicar ticket, cobro ni stock; la misma
 * clave con otro pedido es un error (genérico), no un reuso silencioso.
 *
 * Nombres: el puerto de caja que usa ventas (`estadoDeCajasParaCobrar`, `opcionesDeCobro`) no se nombra fuera de `src/` (`cobrar-no-expuesto.test.ts`);
 * acá se llaman por dentro y hacia afuera salen como `cajasParaCobrar` y `opcionesDeCobroDeLaCaja`.
 */

export type DependenciasDeCobrarWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeVentas"]>, "venderYCobrar" | "anularTicket">;
  consultas: () => Pick<
    ReturnType<Web["consultasDeVentas"]>,
    "estadoDeCajasParaCobrar" | "opcionesParaCobrar"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

type Importe = Readonly<{ moneda: string; monto: string }>;

/** Los datos del cobro sin las claves ausentes: para el dominio `undefined` es «no vino» y no puede viajar como valor (`exactOptionalPropertyTypes`). */
const sinAusentes = (datos: Readonly<Record<string, string | number | undefined>>): DatosDelCobro =>
  Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined)) as DatosDelCobro;
const importe = (i: Importe): Importe => ({ moneda: i.moneda, monto: i.monto });

// ---------------------------------------------------------------------------------------------------------------
// Las cajas con su sesión (lo que decide si se puede cobrar)
// ---------------------------------------------------------------------------------------------------------------

export type CajasParaCobrarParaLaPantalla = Readonly<{
  cajas: readonly Readonly<{
    cajaId: string;
    nombre: string;
    estado: "SIN_SESION" | "ABIERTA" | "EN_CIERRE";
    sesionId: string | null;
    fechaDeNegocio: string | null;
    jornadaVencida: boolean;
  }>[];
  jornadaActual: Readonly<{
    fechaDeNegocio: string;
    estado: "ABIERTA" | "EN_AUDITORIA" | "CERRADA";
  }>;
}>;

/** Las cajas activas de la sucursal con su estado y la jornada de hoy. Es una LECTURA: no escribe ni audita. La sucursal la fija el servidor. */
export function cajasParaCobrar(
  d: DependenciasDeCobrarWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<CajasParaCobrarParaLaPantalla>> {
  return accionDeCobrar(
    d.respuesta,
    {},
    () => ok({}),
    () => d.consultas().estadoDeCajasParaCobrar(contexto, { sucursalId }),
    (estado) => ({
      cajas: estado.cajas.map((c) => ({
        cajaId: c.cajaId,
        nombre: c.nombre,
        estado: c.estado,
        sesionId: c.sesionId,
        fechaDeNegocio: c.fechaDeNegocio,
        jornadaVencida: c.jornadaVencida,
      })),
      jornadaActual: {
        fechaDeNegocio: estado.jornadaActual.fechaDeNegocio,
        estado: estado.jornadaActual.estado,
      },
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Las opciones de cobro de una caja
// ---------------------------------------------------------------------------------------------------------------

export type OpcionesDeCobroParaLaPantalla = Readonly<{
  medios: readonly Readonly<{
    id: string;
    tipo: string;
    nombre: string | null;
    cuentaObligatoria: boolean;
    cuentas: readonly Readonly<{ id: string; tipo: string; nombre: string }>[];
    datosQuePide: Readonly<{
      cupon: boolean;
      ultimos4: boolean;
      marca: boolean;
      cuotas: boolean;
      dni: boolean;
    }>;
  }>[];
  marcasDeTarjeta: readonly Readonly<{ id: string; nombre: string }>[];
}>;

/** Medios activos, cuentas de la sucursal de la caja, qué datos pide cada medio y las marcas. La caja tiene que ser de una sucursal del alcance. */
export function opcionesDeCobroDeLaCaja(
  d: DependenciasDeCobrarWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<OpcionesDeCobroParaLaPantalla>> {
  return accionDeCobrar(
    d.respuesta,
    crudo,
    entradaDeOpcionesDeCobro,
    (entrada) => d.consultas().opcionesParaCobrar(contexto, entrada),
    (opciones) => ({
      medios: opciones.medios.map((m) => ({
        id: m.id,
        tipo: m.tipo,
        nombre: m.nombre,
        cuentaObligatoria: m.cuentaObligatoria,
        cuentas: m.cuentas.map((c) => ({ id: c.id, tipo: c.tipo, nombre: c.nombre })),
        datosQuePide: {
          cupon: m.datosQuePide.cupon,
          ultimos4: m.datosQuePide.ultimos4,
          marca: m.datosQuePide.marca,
          cuotas: m.datosQuePide.cuotas,
          dni: m.datosQuePide.dni,
        },
      })),
      marcasDeTarjeta: opciones.marcasDeTarjeta.map((m) => ({ id: m.id, nombre: m.nombre })),
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Cobrar la venta
// ---------------------------------------------------------------------------------------------------------------

export type VentaCobradaParaLaPantalla = Readonly<{
  ticketId: string;
  /** El ejemplar ORIGINAL del ticket: lo que la pantalla manda después para anularlo (`ejemplarBaseId`). */
  ejemplarId: string;
  numero: number;
  estado: string;
  fechaNegocio: string;
  total: Importe;
  cobranzaId: string | null;
  cobros: readonly Readonly<{
    orden: number;
    medioDePagoId: string;
    cuentaDeCobroId: string | null;
    importe: Importe;
  }>[];
  pendienteDeFacturar: boolean;
  /** `true` si esta clave ya había cobrado: la pantalla muestra lo hecho, no un segundo cobro. */
  yaExistia: boolean;
}>;

/**
 * Cobra la venta del mostrador en UN acto: cuenta, líneas, ticket, stock, cobro y caja, todo o nada (`venderYCobrar`). El vuelto es presentación y se
 * resuelve ANTES, en el cliente (`calcularVuelto`): al servidor llega lo que queda en caja, que tiene que cuadrar con el total al centavo.
 */
export function cobrarLaVenta(
  d: DependenciasDeCobrarWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<VentaCobradaParaLaPantalla>> {
  return accionDeCobrar(
    d.respuesta,
    crudo,
    entradaDeCobrarLaVenta,
    (entrada) =>
      d.casosDeUso().venderYCobrar(contexto, {
        claveIdempotencia: entrada.claveIdempotencia,
        cuentaId: entrada.cuentaId,
        ejemplarId: entrada.ejemplarId,
        sucursalId,
        lineas: entrada.lineas,
        totalEsperado: entrada.totalEsperado,
        confirmaciones: entrada.confirmaciones,
        cobro: {
          cajaId: entrada.cajaId,
          cobros: entrada.cobros.map((c) => ({
            medioDePagoId: c.medioDePagoId,
            cuentaDeCobroId: c.cuentaDeCobroId,
            importe: c.importe,
            ...(c.datos === undefined ? {} : { datos: sinAusentes(c.datos) }),
          })),
        },
      }),
    (venta) => ({
      ticketId: venta.ticketId,
      ejemplarId: venta.ejemplarId,
      numero: venta.numero,
      estado: venta.estado,
      fechaNegocio: venta.fechaNegocio,
      total: importe(venta.total),
      cobranzaId: venta.cobranzaId,
      cobros: venta.cobros.map((c) => ({
        orden: c.orden,
        medioDePagoId: c.medioDePagoId,
        cuentaDeCobroId: c.cuentaDeCobroId,
        importe: importe(c.importe),
      })),
      pendienteDeFacturar: venta.pendienteDeFacturar,
      yaExistia: venta.yaExistia,
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Anular desde el resultado
// ---------------------------------------------------------------------------------------------------------------

export type TicketAnuladoParaLaPantalla = Readonly<{
  ticketId: string;
  numero: number;
  estado: "ANULADO";
  numeroDeCorreccion: number;
  yaExistia: boolean;
}>;

/** Anula el ticket recién cobrado (decisión 172: «anular todo» con motivo). Idempotente por la clave y el `ejemplarNuevoId` de la pantalla. */
export function anularElTicket(
  d: DependenciasDeCobrarWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<TicketAnuladoParaLaPantalla>> {
  return accionDeCobrar(
    d.respuesta,
    crudo,
    entradaDeAnularElTicket,
    (entrada) => d.casosDeUso().anularTicket(contexto, entrada),
    (anulado) => ({
      ticketId: anulado.ticketId,
      numero: anulado.numero,
      estado: anulado.estado,
      numeroDeCorreccion: anulado.numeroDeCorreccion,
      yaExistia: anulado.yaExistia,
    }),
  );
}
