import { ok } from "../../primitivas/resultado/resultado";
import type { GanchoDeSucursal, TxDeEmpresas } from "../empresas/publico";
import {
  asegurarCajaPorDefectoEnTx,
  type TxParaCajaPorDefecto,
} from "./casos-de-uso/caja-por-defecto";

/**
 * El gancho de caja para `crearSucursal` (decisión 165; e3 §3.2.1 a): «Caja 1» nace en la MISMA transacción que la sucursal, solo si la
 * sucursal se creó (empresas no lo invoca en una repetición). Usa la función única; sin guard propio (la autorización es la de crear la
 * sucursal) y sin límite del plan. No devuelve `GANCHO_DE_SUCURSAL_FALLIDO`: un fallo de la base se lanza, y eso revierte la sucursal
 * entera (y deja que el adaptador reintente un conflicto serializable). Solo importa los TIPOS del puerto de empresas.
 * Previene una sucursal recién creada sin caja, que no podría cobrar. Se registra en la composición (`armarWeb`).
 */
export const ganchoDeSucursalDeCaja: GanchoDeSucursal<TxDeEmpresas & TxParaCajaPorDefecto> = {
  async alCrearSucursalEnTx(tx, contexto, sucursal) {
    await asegurarCajaPorDefectoEnTx(tx, contexto, sucursal.sucursalId);
    return ok(null);
  },
};
