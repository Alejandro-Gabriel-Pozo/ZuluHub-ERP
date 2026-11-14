import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  anularCuentaEnTx,
  abrirCuentaEnTx,
  agregarLineaEnTx,
  cuentaAbiertaPorAncla,
  cuentaPorId,
  lineasDeCuenta,
  type EntradaDeAgregarLinea,
  type SalidaDeAgregarLinea,
} from "../../ventas/publico";
import { registrarLineaDeComandaEnTx } from "../../comandas/publico";
import { armarComando, exigirAlcance, exigirUuid } from "./comun";
import type { DependenciasDeSalon, TxDeSalon } from "./contrato";
import {
  ANCLA_DE_MESA,
  claseDeCuenta,
  exigirCuentaUsable,
  MOTIVO_MESA_LIBERADA,
} from "./cuenta-de-mesa";
import type { ErrorDeSalon } from "./errores";

type R<S> = Resultado<S, ErrorDeSalon>;

export type EntradaDeTomarPedido = Readonly<{
  /** Lo manda la pantalla: es la clave de idempotencia del alta de la cuenta. */
  cuentaId: string;
  mesaId: string;
  /** A2c: el departamento del selector (se fija al abrir la cuenta). Ver `EntradaDeAbrirCuenta.departamentoId`. */
  departamentoId?: string | undefined;
}>;
export type SalidaDeTomarPedido = Readonly<{ cuentaId: string; yaExistia: boolean }>;

export type EntradaDeAgregarAlPedido = EntradaDeAgregarLinea &
  Readonly<{ salida?: "AHORA" | "DESPUES" | undefined }>;

export type EntradaDeLiberarMesa = Readonly<{ cuentaId: string }>;
export type SalidaDeLiberarMesa = Readonly<{ yaEstabaLibre: boolean }>;

/**
 * `tomarPedido` (E7 §3.4): abre la cuenta de una mesa con la mesa como ancla. Guard (`cuentas.abrir`), la mesa existe, está en el alcance de quien pide y
 * está activa. Si la mesa ya tiene una cuenta abierta devuelve ESA (dos mozos que tocan «Tomar pedido»: misma cuenta, `yaExistia`); si es la cuenta de
 * reserva de una unión o una división, `MESA_UNIDA` o `MESA_DIVIDIDA` (el índice de ancla de la base lo impondría aunque este código fallara). Abrir la
 * pantalla de una mesa libre NO abre cuenta. Audita `PEDIDO_TOMADO`.
 */
async function tomar(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeTomarPedido,
): Promise<R<SalidaDeTomarPedido>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.cuentaId, entrada.mesaId);
  if (!ids.ok) return ids;
  const mesa = await tx.mesas.obtener(empresaId, entrada.mesaId);
  if (mesa === null) return err("MESA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, mesa.sucursalId);
  if (!alcance.ok) return alcance;
  if (!mesa.activa) return err("MESA_INACTIVA");
  const ancla = { tipo: ANCLA_DE_MESA, id: mesa.id };
  const ocupada = await cuentaAbiertaPorAncla(tx, empresaId, ancla);
  if (ocupada !== null) {
    const usable = exigirCuentaUsable(await claseDeCuenta(tx, contexto, ocupada), false);
    if (!usable.ok) return usable;
    return ok({ cuentaId: ocupada.id, yaExistia: true });
  }
  const abierta = await abrirCuentaEnTx(tx, contexto, persona, {
    cuentaId: entrada.cuentaId,
    sucursalId: mesa.sucursalId,
    departamentoId: entrada.departamentoId,
    ancla,
    etiqueta: `Mesa ${mesa.numero}`,
  });
  if (!abierta.ok) return abierta;
  if (!abierta.valor.yaExistia) {
    await tx.auditoria.registrar({
      empresaId,
      actorPersonaId: persona,
      accion: "PEDIDO_TOMADO",
      entidad: "cuenta_consumo",
      entidadId: abierta.valor.cuentaId,
      despues: { mesaId: mesa.id, numero: mesa.numero, sucursalId: mesa.sucursalId },
    });
  }
  return ok({ cuentaId: abierta.valor.cuentaId, yaExistia: abierta.valor.yaExistia });
}

/**
 * `agregarAlPedido`: agrega un producto a la cuenta de una mesa (o de una hija de una división) con el precio del catálogo, nunca el del cliente, y deja
 * su estado de comanda (`AHORA` por defecto) en la misma transacción. Guard (`cuentas.agregar_linea`); la cuenta es de una mesa usable (la de reserva
 * de una unión o división no admite pedidos). Todo lo demás es de ventas (`agregarLineaEnTx`: jornada abierta, precio, congelado, repetir devuelve la
 * misma posición).
 */
async function agregar(
  tx: TxDeSalon,
  dependencias: DependenciasDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeAgregarAlPedido,
): Promise<R<SalidaDeAgregarLinea>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.cuentaId, entrada.lineaId);
  if (!ids.ok) return ids;
  if (entrada.salida !== undefined && entrada.salida !== "AHORA" && entrada.salida !== "DESPUES") {
    return err("ENTRADA_INVALIDA");
  }
  const cuenta = await cuentaPorId(tx, empresaId, entrada.cuentaId);
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  const usable = exigirCuentaUsable(await claseDeCuenta(tx, contexto, cuenta), true);
  if (!usable.ok) return usable;
  const { salida: _salida, ...paraVentas } = entrada;
  void _salida;
  const agregada = await agregarLineaEnTx(tx, contexto, persona, paraVentas, {
    stock: dependencias.stock,
  });
  if (!agregada.ok) return agregada;
  const comanda = await registrarLineaDeComandaEnTx(tx, contexto, {
    cuentaId: entrada.cuentaId,
    lineaId: entrada.lineaId,
    salida: entrada.salida ?? "AHORA",
  });
  if (!comanda.ok) return comanda;
  return agregada;
}

/**
 * `liberarMesa`: anula la cuenta de una mesa que no tiene ningún ítem vigente (la mesa queda libre). Guard (`cuentas.anular`); con algo vigente,
 * `MESA_CON_PEDIDO` (hay que anular los ítems). No se libera la cuenta de reserva de una unión ni de una división ni una hija. Repetir da
 * `yaEstabaLibre`. Anular no mira la jornada: es la salida de `ventas.cuentas_abiertas`.
 */
async function liberar(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeLiberarMesa,
): Promise<R<SalidaDeLiberarMesa>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.cuentaId);
  if (!ids.ok) return ids;
  const cuenta = await cuentaPorId(tx, empresaId, entrada.cuentaId);
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  const usable = exigirCuentaUsable(await claseDeCuenta(tx, contexto, cuenta), false);
  if (!usable.ok) return usable;
  if (cuenta.estado === "ANULADA") return ok({ yaEstabaLibre: true });
  const lineas = await lineasDeCuenta(tx, empresaId, cuenta.id);
  if (lineas.some((l) => l.estado === "VIGENTE")) return err("MESA_CON_PEDIDO");
  const anulada = await anularCuentaEnTx(tx, contexto, persona, {
    cuentaId: cuenta.id,
    motivo: MOTIVO_MESA_LIBERADA,
  });
  if (!anulada.ok) return anulada;
  return ok({ yaEstabaLibre: anulada.valor.yaEstabaAnulada });
}

export function armarPedido(dependencias: DependenciasDeSalon) {
  const comando = armarComando(dependencias);
  const tomarPedido = comando(["cuentas.abrir"], tomar);
  return {
    /**
     * Dos mozos que tocan «Tomar pedido» a la vez en la misma mesa libre: la única de la base deja pasar a uno; el otro vuelve a pedir y recibe la
     * cuenta del que ganó (`yaExistia`), no un error.
     */
    async tomarPedido(
      contexto: ContextoOperativo,
      entrada: EntradaDeTomarPedido,
    ): Promise<R<SalidaDeTomarPedido>> {
      const primero = await tomarPedido(contexto, entrada);
      return primero.ok || primero.error !== "MESA_NO_LIBRE"
        ? primero
        : tomarPedido(contexto, entrada);
    },
    agregarAlPedido: comando(
      ["cuentas.agregar_linea"],
      (tx, contexto, persona, entrada: EntradaDeAgregarAlPedido) =>
        agregar(tx, dependencias, contexto, persona, entrada),
    ),
    liberarMesa: comando(["cuentas.anular"], liberar),
  };
}
