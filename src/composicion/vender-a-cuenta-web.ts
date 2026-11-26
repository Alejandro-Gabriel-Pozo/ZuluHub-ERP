import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDelClienteParaVender } from "./entradas-de-cuenta-corriente";
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
      saldoDespues: r.saldoDespues ?? null,
      excedeEn: r.excedeEn ?? null,
    }),
  );
}
