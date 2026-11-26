import type { Generated } from "kysely";

/**
 * Tabla de la cuenta corriente de clientes (0106): la ficha de habilitación del cliente a deber. Los importes (`numeric`) se leen y escriben como texto:
 * nunca `number`. La aplicación no escribe `id`, `moneda`, `estado` al alta, fechas ni versión (los fija la base); `estado`, `motivo_de_suspension`, `plazo_dias` y
 * `limite` son lo único que cambia después (privilegio por columna).
 */
export type CuentaDelClienteDb = {
  cuenta_del_cliente: {
    id: Generated<string>;
    empresa_id: string;
    parte_id: string;
    plazo_dias: number;
    limite: string;
    moneda: Generated<string>;
    estado: Generated<"HABILITADA" | "SUSPENDIDA">;
    motivo_de_suspension: string | null;
    clave_idempotencia: string;
    huella: string;
    habilitada_por: string;
    habilitada_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
};
