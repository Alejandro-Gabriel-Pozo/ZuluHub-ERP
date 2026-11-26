import { exigirSucursal } from "../../../capacidades/permisos/alcance";
import {
  sucursalId,
  type EmpresaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  importeAJson,
  importeDesdeTexto,
  restar,
  sumar,
  type Importe,
  type ImporteJson,
} from "../../../primitivas/dinero/importe";
import { FORMA_DEL_IMPORTE } from "../../../primitivas/dinero/forma-del-importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { datosDeLosClientes } from "../consultas/datos-de-clientes";
import { disponibleDe } from "../consultas/disponible";
import type { EstadoDeCuenta } from "../dominio/condiciones";
import { saldoDeParte } from "../../saldos_de_partes/publico";
import { dejarConstancia, prepararCaso, type ErrorPrevio } from "./comun";
import type { DependenciasDeCuentaCorriente, TxDeCuentaCorriente } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

/** Dónde se vende: una cuenta de consumo ABIERTA (la mesa) o, en la venta rápida (que no tiene cuenta hasta cobrar), la sucursal con la que trabaja quien vende. */
type DondeSeVende =
  | Readonly<{ cuentaDeConsumoId: string; sucursalId?: undefined }>
  | Readonly<{ sucursalId: string; cuentaDeConsumoId?: undefined }>;

export type EntradaDeVerClienteParaVender = DondeSeVende &
  Readonly<{
    /** El cliente elegido para esa venta. */
    clienteId: string;
    /**
     * El total de la venta que se va a cargar (texto decimal en pesos). Con él, el SERVIDOR calcula lo que pasaría («saldo después» y cuánto excedería el límite): la pantalla no suma dinero.
     * Es informativo: el cierre vuelve a calcular y a validar el límite con el total real.
     */
    totalDeLaVenta?: string | undefined;
  }>;

/** Lo ÚNICO que ve quien vende: nunca el límite, los movimientos ni la lista de clientes. */
export type ClienteParaVender = Readonly<{
  cliente: Readonly<{ nombre: string | null; cuit: string | null }>;
  estado: EstadoDeCuenta;
  saldo: ImporteJson;
  disponible: ImporteJson;
  excedido: boolean;
  /** Solo si se pasó `totalDeLaVenta`: el saldo del cliente con esta venta cargada. */
  saldoDespues?: ImporteJson;
  /** Solo si se pasó `totalDeLaVenta`: cuánto pasaría del límite (cero si no pasa). */
  excedeEn?: ImporteJson;
}>;

export type ErrorAlVerClienteParaVender =
  | ErrorPrevio
  /** Cuenta de consumo que no existe, no está abierta o no es de una sucursal del actor; o cliente sin ficha (o de otra empresa): un solo código, sin oráculo de existencia. */
  | "CLIENTE_NO_DISPONIBLE"
  | "CONSULTA_NO_DISPONIBLE"
  | "TOTAL_INVALIDO"
  | ErrorDePersistencia;

/**
 * Ver el estado, el saldo y el crédito disponible de UN cliente al venderle a cuenta (CC-5, C3 del dueño; opción A del orquestador). Guard primero (`cuenta_corriente.consultar_al_vender`:
 * los roles que cargan a cuenta); la cuenta de consumo tiene que estar ABIERTA y ser de una sucursal del alcance del actor; el cliente, de la empresa y con ficha. Deja constancia de
 * CADA consulta en la misma transacción (quién, qué cuenta, qué cliente, cuándo; sin importes): si el registro falla no se devuelve el dato. Es lectura: repetirla da lo mismo y deja otro
 * registro. Decisión del dueño (DEC-CCL-003), opción A: el servidor no sabe «cuál es el cliente elegido» antes de cerrar (la cuenta de consumo no lo guarda); quien tiene una cuenta abierta puede consultar un cliente a
 * la vez, con rastro. Pasar a guardar la elección es una migración y una acción más.
 */
/** La sucursal de la venta: la de la cuenta de consumo abierta (la mesa) o la que se pasó (venta rápida); en cualquier otro caso, el mismo «no disponible» (sin oráculo de existencia). */
async function sucursalDeLaVenta(
  dependencias: DependenciasDeCuentaCorriente,
  tx: TxDeCuentaCorriente,
  empresa: EmpresaId,
  entrada: DondeSeVende,
): Promise<Resultado<SucursalId, "CLIENTE_NO_DISPONIBLE" | "CONSULTA_NO_DISPONIBLE">> {
  if (entrada.cuentaDeConsumoId === undefined) {
    return esUuidCanonico(entrada.sucursalId)
      ? ok(sucursalId(entrada.sucursalId))
      : err("CLIENTE_NO_DISPONIBLE");
  }
  const puerto = dependencias.cuentasDeConsumoParaVender;
  if (puerto === undefined) return err("CONSULTA_NO_DISPONIBLE");
  if (!esUuidCanonico(entrada.cuentaDeConsumoId)) return err("CLIENTE_NO_DISPONIBLE");
  const sucursal = await puerto.sucursalDeLaCuentaAbierta(tx, empresa, entrada.cuentaDeConsumoId);
  return sucursal === null ? err("CLIENTE_NO_DISPONIBLE") : ok(sucursal);
}

/** El total que pasa la pantalla: ausente es válido; presente tiene que tener la forma de todo importe (texto decimal, sin signo, hasta 2 decimales). */
function totalDeLaVenta(texto: string | undefined): Resultado<Importe | null, "TOTAL_INVALIDO"> {
  if (texto === undefined) return ok(null);
  return FORMA_DEL_IMPORTE.test(texto) ? ok(importeDesdeTexto(ARS, texto)) : err("TOTAL_INVALIDO");
}

/** Qué pasaría al cargar esta venta: el saldo con ella y cuánto pasaría del límite (cero si no pasa). */
function previsionDeLaVenta(
  limite: Importe,
  saldo: Importe,
  total: Importe,
): Readonly<{ saldoDespues: ImporteJson; excedeEn: ImporteJson }> {
  const despues = sumar(saldo, total);
  const pasa = restar(despues, limite);
  return {
    saldoDespues: importeAJson(despues),
    excedeEn: importeAJson(pasa.unidades > 0n ? pasa : restar(limite, limite)),
  };
}

export function armarVerClienteParaVender(dependencias: DependenciasDeCuentaCorriente) {
  return async function verClienteParaVender(
    contexto: ContextoOperativo,
    entrada: EntradaDeVerClienteParaVender,
  ): Promise<Resultado<ClienteParaVender, ErrorAlVerClienteParaVender>> {
    return dependencias.transacciones.ejecutar(
      { contexto, aislamiento: "serializable" },
      async (tx): Promise<Resultado<ClienteParaVender, ErrorAlVerClienteParaVender>> => {
        const previo = await prepararCaso(
          tx,
          contexto,
          dependencias.reglas,
          DECLARACIONES.verClienteParaVender.accion,
        );
        if (!previo.ok) return previo;
        if (!esUuidCanonico(entrada.clienteId)) return err("CLIENTE_NO_DISPONIBLE");
        const empresa = contexto.empresaId;
        const sucursal = await sucursalDeLaVenta(dependencias, tx, empresa, entrada);
        if (!sucursal.ok) return sucursal;
        const alcance = exigirSucursal(
          await tx.autorizacion.sucursalesDelActor(contexto),
          sucursal.valor,
        );
        if (!alcance.ok) return err("CLIENTE_NO_DISPONIBLE");
        const ficha = await tx.cuentasDeClientes.obtenerPorParte(empresa, entrada.clienteId);
        if (ficha === null) return err("CLIENTE_NO_DISPONIBLE");

        const total = totalDeLaVenta(entrada.totalDeLaVenta);
        if (!total.ok) return total;
        const saldo = await saldoDeParte(tx, contexto, ficha.parteId, "A_COBRAR");
        const prevision =
          total.valor === null ? null : previsionDeLaVenta(ficha.limite, saldo, total.valor);
        const { disponible, excedido } = disponibleDe(ficha.limite, saldo);
        const datos = (await datosDeLosClientes(tx, empresa, [ficha.parteId])).get(ficha.parteId);
        // La constancia va ANTES de devolver el dato y en la misma transacción; si falla, no sale nada.
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "CUENTA_CORRIENTE_CONSULTADA_AL_VENDER",
          entidadId: ficha.id,
          despues:
            entrada.cuentaDeConsumoId === undefined
              ? { sucursalId: entrada.sucursalId, parteId: ficha.parteId }
              : { cuentaDeConsumoId: entrada.cuentaDeConsumoId, parteId: ficha.parteId },
        });
        return ok({
          cliente: datos ?? { nombre: null, cuit: null },
          estado: ficha.estado,
          saldo: importeAJson(saldo),
          disponible: importeAJson(disponible),
          excedido,
          ...(prevision === null ? {} : prevision),
        });
      },
    );
  };
}
