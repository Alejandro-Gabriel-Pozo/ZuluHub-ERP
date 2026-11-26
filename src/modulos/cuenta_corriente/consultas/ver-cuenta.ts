import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia, Transacciones } from "../../../puertos/transacciones";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import { saldoDeParte } from "../../saldos_de_partes/publico";
import type { TxDeSaldos } from "../../saldos_de_partes/publico";
import { disponibleDe } from "./disponible";
import { aCuentaPublica, type CuentaPublica } from "../casos-de-uso/cuenta-publica";
import type { RepositorioDeCuentasDeClientes } from "../persistencia/repositorio-de-cuentas";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * Lo que recibe el trabajo de una consulta (ADR-005): solo lecturas y la carga de autorización. No hay auditoría: por tipos, una consulta no escribe.
 */
export type TxDeConsultasDeCuentaCorriente = Readonly<{
  cuentasDeClientes: Pick<RepositorioDeCuentasDeClientes, "obtenerPorParte">;
  saldos: TxDeSaldos["saldos"];
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDeConsultasDeCuentaCorriente = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeCuentaCorriente>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;

export type EntradaDeVerCuenta = Readonly<{ parteId: string }>;

export type VistaDeLaCuenta = Readonly<{
  cuenta: CuentaPublica;
  /** Lo que el cliente debe según el libro de saldos (sentido A_COBRAR): positivo = debe; negativo = saldo a favor. */
  saldo: ImporteJson;
  /** Límite menos saldo, nunca negativo. */
  disponible: ImporteJson;
  /** `true`: el saldo supera el límite (el disponible es cero). */
  excedido: boolean;
}>;

export type ErrorAlVerCuenta = "CUENTA_NO_ENCONTRADA" | MotivoDeRechazo | ErrorDePersistencia;

/**
 * La ficha del cliente con su saldo y su disponible (CC-1). Pide `cuenta_corriente.ver` al guard dentro de su transacción (`read committed`, solo lectura) y lee el
 * saldo del libro (`saldoDeParte`, A_COBRAR) de la empresa del contexto: el saldo de otro cliente de la misma empresa nunca se mezcla. Una parte sin ficha (o de otra
 * empresa) es `CUENTA_NO_ENCONTRADA`: no hay forma de saber si existe. Disponible = límite − saldo, sin bajar de cero; con el saldo por encima del límite figura
 * «excedido». El disponible no autoriza ni bloquea nada: lo usa CC-2.
 */
export function armarVerCuentaDelCliente({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeCuentaCorriente) {
  return async function verCuentaDelCliente(
    contexto: ContextoOperativo,
    entrada: EntradaDeVerCuenta,
  ): Promise<Resultado<VistaDeLaCuenta, ErrorAlVerCuenta>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<VistaDeLaCuenta, "CUENTA_NO_ENCONTRADA" | MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.verCuentaDelCliente.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const cuenta = await tx.cuentasDeClientes.obtenerPorParte(
          contexto.empresaId,
          entrada.parteId,
        );
        if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
        const saldo = await saldoDeParte(tx, contexto, cuenta.parteId, "A_COBRAR");
        const { disponible, excedido } = disponibleDe(cuenta.limite, saldo);
        return ok({
          cuenta: aCuentaPublica(cuenta),
          saldo: importeAJson(saldo),
          disponible: importeAJson(disponible),
          excedido,
        });
      },
    );
  };
}
