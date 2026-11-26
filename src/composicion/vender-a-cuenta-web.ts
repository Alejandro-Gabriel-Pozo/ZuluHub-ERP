import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeCerrarLaMesaACuenta, entradaDeVenderACuenta } from "./entradas-de-cobrar";
import { entradaDelClienteParaVender } from "./entradas-de-cuenta-corriente";
import { accionDeCobrar } from "./errores-de-cobrar";
import { accionDeClientes } from "./errores-de-clientes";
import type { Web } from "./web";

/**
 * Elegir cliente al vender a cuenta (CC-5, B1a): la lista de clientes y el saldo de UNO ya elegido, para quien vende (el cajero). Cada una ya trae su permiso (`cargar_a_cuenta` la lista,
 * `consultar_al_vender` el saldo), su aislamiento por empresa y su transacción; acá solo se arma el pedido y se presenta lo que la hoja necesita:
 *  - **La empresa, la persona y la sucursal las pone el servidor**, nunca el pedido: en la venta rápida la sucursal es la de trabajo (`sucursalDeTrabajo`, validada contra el alcance); sin ella no se consulta.
 *  - **La lista no trae saldos ni límites**: solo nombre, CUIT, plazo y estado. El saldo, el crédito y la previsión salen de UN cliente a la vez, con constancia, y los calcula el SERVIDOR (la pantalla no suma dinero).
 *  - Todo error de negocio (cliente que no es de la persona, cuenta de otra sucursal, total mal formado) sale como el genérico: nunca un oráculo de existencia.
 * Previene: un cajero que ve la cartera completa, un saldo de otra empresa o de una sucursal fuera de su alcance y un «saldo después» calculado en el navegador. Chequeo: `test/integracion/cuenta-corriente-vender-a-cuenta-web.test.ts`.
 */

export type DependenciasDeVenderACuentaWeb = Readonly<{
  consultas: () => Pick<ReturnType<Web["consultasDeCuentaCorriente"]>, "listarClientesParaVender">;
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeCuentaCorriente"]>, "verClienteParaVender">;
  respuesta: DependenciasDeRespuesta;
}>;

type Importe = Readonly<{ moneda: string; monto: string }>;

export type ClientesParaVenderParaLaPantalla = Readonly<{
  clientes: readonly Readonly<{
    parteId: string;
    nombre: string | null;
    cuit: string | null;
    plazoDias: number;
    estado: "HABILITADA" | "SUSPENDIDA";
  }>[];
}>;

/** Los clientes que se pueden elegir (activos con ficha, también la suspendida). Es una LECTURA. */
export function listarLosClientesParaVender(
  d: DependenciasDeVenderACuentaWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<ClientesParaVenderParaLaPantalla>> {
  return accionDeClientes(
    d.respuesta,
    {},
    () => ({ ok: true, valor: {} }),
    () => d.consultas().listarClientesParaVender(contexto),
    (lista): ClientesParaVenderParaLaPantalla => ({
      clientes: lista.map((c) => ({
        parteId: c.parteId,
        nombre: c.nombre,
        cuit: c.cuit,
        plazoDias: c.plazoDias,
        estado: c.estado,
      })),
    }),
  );
}

export type ClienteElegidoParaLaPantalla = Readonly<{
  nombre: string | null;
  cuit: string | null;
  estado: "HABILITADA" | "SUSPENDIDA";
  saldo: Importe;
  disponible: Importe;
  excedido: boolean;
  /** Lo decide el servidor (`cuenta_corriente.aprobar_exceso`): la pantalla solo elige qué texto mostrar si la venta pasa el límite. */
  puedeAprobarElExceso: boolean;
  /** Solo si se pasó el total de la venta: el saldo con ella y cuánto pasaría del límite, calculados por el servidor. */
  saldoDespues: Importe | null;
  excedeEn: Importe | null;
}>;

/**
 * El saldo, el crédito y la previsión de UN cliente elegido. Con `cuentaDeConsumoId` (la mesa) se mira esa cuenta abierta; sin él (venta rápida), la sucursal de trabajo que llega ya resuelta por el
 * servidor (`""` es «sin sucursal elegida»: no se consulta, nunca se asume «todas»). Cada consulta deja su constancia sin importes.
 */
export function verElClienteParaVender(
  d: DependenciasDeVenderACuentaWeb,
  contexto: ContextoOperativo,
  sucursalDeTrabajo: string,
  crudo: unknown,
): Promise<Respuesta<ClienteElegidoParaLaPantalla>> {
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDelClienteParaVender,
    (entrada) => {
      const total =
        entrada.totalDeLaVenta === undefined ? {} : { totalDeLaVenta: entrada.totalDeLaVenta };
      if (entrada.cuentaDeConsumoId !== undefined) {
        return d.casosDeUso().verClienteParaVender(contexto, {
          clienteId: entrada.clienteId,
          cuentaDeConsumoId: entrada.cuentaDeConsumoId,
          ...total,
        });
      }
      return d.casosDeUso().verClienteParaVender(contexto, {
        clienteId: entrada.clienteId,
        sucursalId: sucursalDeTrabajo,
        ...total,
      });
    },
    (r): ClienteElegidoParaLaPantalla => ({
      nombre: r.cliente.nombre,
      cuit: r.cliente.cuit,
      estado: r.estado,
      saldo: r.saldo,
      disponible: r.disponible,
      excedido: r.excedido,
      puedeAprobarElExceso: r.puedeAprobarElExceso,
      saldoDespues: r.saldoDespues ?? null,
      excedeEn: r.excedeEn ?? null,
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Confirmar la venta a cuenta (mostrador) y cerrar la mesa a cuenta (salón)
// ---------------------------------------------------------------------------------------------------------------

/** Lo que sale a la pantalla de una venta cargada a la cuenta de un cliente (lista blanca campo por campo): el ticket, sin cobros ni caja (no entró plata). */
export type VentaACuentaParaLaPantalla = Readonly<{
  ticketId: string;
  /** El ejemplar ORIGINAL del ticket: lo que la pantalla manda después para anularlo (`ejemplarBaseId`). */
  ejemplarId: string;
  numero: number;
  estado: string;
  fechaNegocio: string;
  total: Importe;
  /** `true` si esta venta ya estaba cerrada (reintento): la pantalla muestra lo hecho, no una segunda venta. */
  yaExistia: boolean;
}>;

const presentarLaVentaACuenta = (venta: {
  ticketId: string;
  ejemplarId: string;
  numero: number;
  estado: string;
  fechaNegocio: string;
  total: Importe;
  yaEstabaCerrada: boolean;
}): VentaACuentaParaLaPantalla => ({
  ticketId: venta.ticketId,
  ejemplarId: venta.ejemplarId,
  numero: venta.numero,
  estado: venta.estado,
  fechaNegocio: venta.fechaNegocio,
  total: { moneda: venta.total.moneda, monto: venta.total.monto },
  yaExistia: venta.yaEstabaCerrada,
});

export type DependenciasDeVenderACuentaEnElMostrador = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeVentas"]>, "venderACuenta">;
  respuesta: DependenciasDeRespuesta;
}>;

/**
 * Confirma la venta rápida a cuenta (`venderACuenta`): cuenta, líneas, ticket, stock y cargo a la cuenta corriente del cliente, todo o nada, en UNA transacción. Misma frontera y mismo traductor de errores que
 * cobrar (`entradas-de-cobrar.ts`, `errores-de-cobrar.ts`): todo rechazo de negocio (límite pasado, cliente suspendido o de otra empresa, total que cambió, venta de $ 0) sale como el genérico ya aprobado.
 *  - **Repetir no duplica**: la cuenta y el ejemplar los fija la pantalla por intento; repetir devuelve el mismo ticket y no vuelve a cargar nada.
 *  - **La sucursal la fija el servidor** (la de trabajo, validada contra el alcance); vacía cierra. **El permiso lo exige el caso de uso adentro** (`cuentas.cerrar` y `cuenta_corriente.cargar_a_cuenta`).
 *  - **Sin aprobación del exceso**: el pedido no la admite; con el límite pasado el servidor rechaza.
 */
export function venderLaVentaACuenta(
  d: DependenciasDeVenderACuentaEnElMostrador,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<VentaACuentaParaLaPantalla>> {
  return accionDeCobrar(
    d.respuesta,
    sucursalId === "" ? null : crudo,
    entradaDeVenderACuenta,
    (entrada) =>
      d.casosDeUso().venderACuenta(contexto, {
        cuentaId: entrada.cuentaId,
        ejemplarId: entrada.ejemplarId,
        sucursalId,
        lineas: entrada.lineas,
        totalEsperado: entrada.totalEsperado,
        confirmaciones: entrada.confirmaciones,
        clienteId: entrada.clienteId,
      }),
    presentarLaVentaACuenta,
  );
}

export type DependenciasDeCerrarLaMesaACuenta = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeSalon"]>, "cerrarMesaACuenta">;
  respuesta: DependenciasDeRespuesta;
}>;

/**
 * Cierra la cuenta de una mesa a nombre de un cliente (`cerrarMesaACuenta`), sin cobro de caja: ticket, stock, cargo a la cuenta corriente y mesa libre, todo o nada. Mismas reglas que la venta rápida: repetir
 * devuelve el mismo ticket, la sucursal la fija el servidor (una cuenta de otra sucursal es el genérico) y el pedido no admite aprobación del exceso. Con platos sin enviar no se cierra.
 */
export function cerrarLaMesaACuenta(
  d: DependenciasDeCerrarLaMesaACuenta,
  contexto: ContextoOperativo,
  sucursalDeTrabajo: string,
  crudo: unknown,
): Promise<Respuesta<VentaACuentaParaLaPantalla>> {
  return accionDeCobrar(
    d.respuesta,
    sucursalDeTrabajo === "" ? null : crudo,
    entradaDeCerrarLaMesaACuenta,
    (entrada) =>
      d.casosDeUso().cerrarMesaACuenta(contexto, {
        cuentaId: entrada.cuentaId,
        ejemplarId: entrada.ejemplarId,
        clienteId: entrada.clienteId,
        totalEsperado: entrada.totalEsperado,
        confirmaciones: entrada.confirmaciones,
        sucursalDeTrabajo,
      }),
    presentarLaVentaACuenta,
  );
}
