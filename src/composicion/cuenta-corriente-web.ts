import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeLaFicha, entradaDeLaLista } from "./entradas-de-cuenta-corriente";
import { accionDeClientes } from "./errores-de-clientes";
import type { Web } from "./web";

/**
 * Las pantallas de la cuenta corriente de clientes (CC-5, A1): la lista de clientes con cuenta y la ficha con su estado de cuenta. Cada una es una LECTURA (no escribe ni audita) que ya trae su permiso
 * (`cuenta_corriente.ver`), su aislamiento por empresa y su transacción. Acá solo se arma el pedido y se presenta lo que la pantalla necesita:
 *  - **La empresa y la persona salen del contexto**, nunca del pedido; un campo de más en el pedido es el genérico.
 *  - Todo sale campo por campo (lista de permitidos): nada del ficha interna (ni su clave ni su huella ni su versión) y ningún id de persona.
 *  - Los errores de negocio salen como el genérico («Esta acción no está permitida»): una ficha que no existe o es de otra empresa es indistinguible de un permiso que falta.
 * Previene: una lista o una ficha con datos de otra empresa o de otro cliente, un permiso decidido por la pantalla y un error crudo del módulo en el navegador. Chequeo: `test/integracion/cuenta-corriente-web.test.ts`.
 */

export type DependenciasDeCuentaCorrienteWeb = Readonly<{
  consultas: () => Pick<
    ReturnType<Web["consultasDeCuentaCorriente"]>,
    "listarClientesConCuenta" | "verEstadoDeCuenta"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

type Importe = Readonly<{ moneda: string; monto: string }>;

export type EstadoVisibleDelCliente = "HABILITADA" | "SUSPENDIDA" | "EXCEDIDA";

/** «Excedida» no es un estado de la ficha: es la habilitada cuyo saldo pasó el límite (decisión del dueño, 26/11/2026). Una suspendida sigue figurando suspendida. */
const estadoVisible = (
  estado: "HABILITADA" | "SUSPENDIDA",
  excedido: boolean,
): EstadoVisibleDelCliente =>
  estado === "SUSPENDIDA" ? "SUSPENDIDA" : excedido ? "EXCEDIDA" : "HABILITADA";

export type ListaDeCuentasParaLaPantalla = Readonly<{
  orden: "SALDO" | "VENCIDO" | "ANTIGUEDAD";
  /** El día (`AAAA-MM-DD`, Argentina) al que se calcularon «vencido» y la antigüedad. */
  alDia: string;
  clientes: readonly Readonly<{
    parteId: string;
    nombre: string | null;
    cuit: string | null;
    estado: EstadoVisibleDelCliente;
    saldo: Importe;
    vencido: Importe;
    limite: Importe;
    disponible: Importe;
    /** El cargo abierto más antiguo: su fecha de negocio y los días que lleva; `null` sin cargos abiertos. */
    cargoMasAntiguo: Readonly<{ fecha: string; dias: number }> | null;
  }>[];
}>;

export function listarLasCuentas(
  d: DependenciasDeCuentaCorrienteWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ListaDeCuentasParaLaPantalla>> {
  const pedido = entradaDeLaLista(crudo);
  const ordenPedido = pedido.ok ? pedido.valor.orden : "SALDO";
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDeLaLista,
    (entrada) => d.consultas().listarClientesConCuenta(contexto, { orden: entrada.orden }),
    (lista): ListaDeCuentasParaLaPantalla => ({
      orden: ordenPedido,
      alDia: lista.alDia,
      clientes: lista.clientes.map((c) => ({
        parteId: c.cuenta.parteId,
        nombre: c.nombre,
        cuit: c.cuit,
        estado: estadoVisible(c.cuenta.estado, c.excedido),
        saldo: c.saldo,
        vencido: c.vencido,
        limite: c.cuenta.limite,
        disponible: c.disponible,
        cargoMasAntiguo:
          c.fechaDelCargoMasAntiguo === null || c.antiguedadEnDias === null
            ? null
            : { fecha: c.fechaDelCargoMasAntiguo, dias: c.antiguedadEnDias },
      })),
    }),
  );
}

export type FichaDeCuentaParaLaPantalla = Readonly<{
  parteId: string;
  nombre: string | null;
  cuit: string | null;
  estado: EstadoVisibleDelCliente;
  /** Solo si está suspendida: el motivo con el que se suspendió (quién y cuándo no se guardan en la ficha). */
  motivoDeSuspension: string | null;
  plazoDias: number;
  limite: Importe;
  saldo: Importe;
  disponible: Importe;
  movimientos: readonly Readonly<{
    fecha: string;
    tipo: "VENTA_A_CUENTA" | "VENTA_ANULADA" | "COBRANZA" | "COBRANZA_ANULADA" | "OTRO";
    vence: string | null;
    vencida: boolean;
    importe: Importe;
    /** El ticket detrás del movimiento; `null` si no se pudo determinar. */
    ticket: Readonly<{
      numero: number;
      canal: "SALON" | "MOSTRADOR";
      sucursal: string | null;
    }> | null;
    /** El tipo de medio con el que se cobró (una cobranza con un solo medio); `null` en el resto. */
    medioDePago: string | null;
  }>[];
}>;

export function fichaDeLaCuenta(
  d: DependenciasDeCuentaCorrienteWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<FichaDeCuentaParaLaPantalla>> {
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDeLaFicha,
    (entrada) => d.consultas().verEstadoDeCuenta(contexto, { parteId: entrada.parteId }),
    (e): FichaDeCuentaParaLaPantalla => ({
      parteId: e.cuenta.parteId,
      nombre: e.cliente.nombre,
      cuit: e.cliente.cuit,
      estado: estadoVisible(e.cuenta.estado, e.excedido),
      motivoDeSuspension: e.cuenta.estado === "SUSPENDIDA" ? e.cuenta.motivoDeSuspension : null,
      plazoDias: e.cuenta.plazoDias,
      limite: e.cuenta.limite,
      saldo: e.saldo,
      disponible: e.disponible,
      movimientos: e.lineas.map((l) => ({
        fecha: l.fechaDeNegocio,
        tipo: l.tipo,
        vence: l.venceEl,
        vencida: l.vencida,
        importe: l.importe,
        ticket: l.ticket,
        medioDePago: l.medioDePago,
      })),
    }),
  );
}
