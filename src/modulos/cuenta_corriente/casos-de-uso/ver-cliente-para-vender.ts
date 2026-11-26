import { exigirSucursal } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { datosDeLosClientes } from "../consultas/datos-de-clientes";
import { disponibleDe } from "../consultas/disponible";
import type { EstadoDeCuenta } from "../dominio/condiciones";
import { saldoDeParte } from "../../saldos_de_partes/publico";
import { dejarConstancia, prepararCaso, type ErrorPrevio } from "./comun";
import type { DependenciasDeCuentaCorriente } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeVerClienteParaVender = Readonly<{
  /** La cuenta de consumo que se está vendiendo (abierta, de una sucursal del actor). */
  cuentaDeConsumoId: string;
  /** El cliente elegido para esa venta. */
  clienteId: string;
}>;

/** Lo ÚNICO que ve quien vende: nunca el límite, los movimientos ni la lista de clientes. */
export type ClienteParaVender = Readonly<{
  cliente: Readonly<{ nombre: string | null; cuit: string | null }>;
  estado: EstadoDeCuenta;
  saldo: ImporteJson;
  disponible: ImporteJson;
  excedido: boolean;
}>;

export type ErrorAlVerClienteParaVender =
  | ErrorPrevio
  /** Cuenta de consumo que no existe, no está abierta o no es de una sucursal del actor; o cliente sin ficha (o de otra empresa): un solo código, sin oráculo de existencia. */
  | "CLIENTE_NO_DISPONIBLE"
  | "CONSULTA_NO_DISPONIBLE"
  | ErrorDePersistencia;

/**
 * Ver el estado, el saldo y el crédito disponible de UN cliente al venderle a cuenta (CC-5, C3 del dueño; opción A del orquestador). Guard primero (`cuenta_corriente.consultar_al_vender`:
 * los roles que cargan a cuenta); la cuenta de consumo tiene que estar ABIERTA y ser de una sucursal del alcance del actor; el cliente, de la empresa y con ficha. Deja constancia de
 * CADA consulta en la misma transacción (quién, qué cuenta, qué cliente, cuándo; sin importes): si el registro falla no se devuelve el dato. Es lectura: repetirla da lo mismo y deja otro
 * registro. Decisión del dueño (DEC-CCL-003), opción A: el servidor no sabe «cuál es el cliente elegido» antes de cerrar (la cuenta de consumo no lo guarda); quien tiene una cuenta abierta puede consultar un cliente a
 * la vez, con rastro. Pasar a guardar la elección es una migración y una acción más.
 */
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
        const puerto = dependencias.cuentasDeConsumoParaVender;
        if (puerto === undefined) return err("CONSULTA_NO_DISPONIBLE");
        if (!esUuidCanonico(entrada.cuentaDeConsumoId) || !esUuidCanonico(entrada.clienteId)) {
          return err("CLIENTE_NO_DISPONIBLE");
        }
        const empresa = contexto.empresaId;
        const sucursal = await puerto.sucursalDeLaCuentaAbierta(
          tx,
          empresa,
          entrada.cuentaDeConsumoId,
        );
        if (sucursal === null) return err("CLIENTE_NO_DISPONIBLE");
        const alcance = exigirSucursal(
          await tx.autorizacion.sucursalesDelActor(contexto),
          sucursal,
        );
        if (!alcance.ok) return err("CLIENTE_NO_DISPONIBLE");
        const ficha = await tx.cuentasDeClientes.obtenerPorParte(empresa, entrada.clienteId);
        if (ficha === null) return err("CLIENTE_NO_DISPONIBLE");

        const saldo = await saldoDeParte(tx, contexto, ficha.parteId, "A_COBRAR");
        const { disponible, excedido } = disponibleDe(ficha.limite, saldo);
        const datos = (await datosDeLosClientes(tx, empresa, [ficha.parteId])).get(ficha.parteId);
        // La constancia va ANTES de devolver el dato y en la misma transacción; si falla, no sale nada.
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "CUENTA_CORRIENTE_CONSULTADA_AL_VENDER",
          entidadId: ficha.id,
          despues: { cuentaDeConsumoId: entrada.cuentaDeConsumoId, parteId: ficha.parteId },
        });
        return ok({
          cliente: datos ?? { nombre: null, cuit: null },
          estado: ficha.estado,
          saldo: importeAJson(saldo),
          disponible: importeAJson(disponible),
          excedido,
        });
      },
    );
  };
}
