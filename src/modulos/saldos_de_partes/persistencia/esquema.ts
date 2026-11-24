import type { Generated } from "kysely";
import type { Sentido, SignoDeClase } from "../dominio/clases";

/**
 * Las tablas del libro de saldos (0092). Las fechas (`date`) y los instantes se leen como texto o `Date`; los importes (`numeric`) siempre como
 * texto decimal: nunca `number`. La aplicación inserta por columna (los privilegios de `0092` lo fijan): `id`, `registrado_en` y `fecha_negocio`
 * los pone la base; los cuatro `saldo_*` los escribe solo un disparador (la aplicación los lee).
 */
export type SaldosDb = {
  clase_de_asiento: {
    sentido: Sentido;
    clase: string;
    signo: SignoDeClase;
    exige_detalle: boolean;
    admite_vencimiento: boolean;
  };
  asiento_de_saldo: {
    id: Generated<string>;
    empresa_id: string;
    parte_id: string;
    sentido: Sentido;
    clase: string;
    naturaleza: Generated<"ORIGINAL" | "ANULACION">;
    importe: string;
    moneda: Generated<string>;
    origen_tipo: string;
    origen_id: string;
    origen_orden: Generated<number>;
    referencia_tipo: string | null;
    referencia_id: string | null;
    vence_el: string | null;
    detalle: string | null;
    anula_a: string | null;
    clave_idempotencia: string;
    huella: string;
    hecho_en: Date;
    registrado_en: Generated<Date>;
    fecha_negocio: Generated<string>;
    registrado_por: string;
  };
  distribucion_de_asiento: {
    id: Generated<string>;
    empresa_id: string;
    asiento_id: string;
    sucursal_id: string | null;
    importe: string;
    moneda: Generated<string>;
  };
  imputacion_de_saldo: {
    id: Generated<string>;
    empresa_id: string;
    numero: number;
    saldante_id: string;
    saldado_id: string;
    parte_id: string;
    sentido: Sentido;
    importe: string;
    moneda: Generated<string>;
    clave_idempotencia: string;
    huella: string;
    registrado_en: Generated<Date>;
    registrado_por: string;
  };
  saldo_de_asiento: {
    empresa_id: string;
    asiento_id: string;
    tope: string;
    importe_imputado: string;
    anulado: boolean;
  };
  saldo_de_imputacion: {
    empresa_id: string;
    saldante_id: string;
    saldado_id: string;
    importe: string;
  };
  saldo_de_parte: {
    empresa_id: string;
    parte_id: string;
    sentido: Sentido;
    moneda: string;
    saldo: string;
  };
  saldo_de_parte_por_centro_de_costo: {
    id: Generated<string>;
    empresa_id: string;
    parte_id: string;
    sentido: Sentido;
    moneda: string;
    sucursal_id: string | null;
    saldo: string;
  };
};

/**
 * Las columnas que el TypeScript declara de cada tabla, en el orden de la base. Una prueba de integración las compara con el catálogo de la base:
 * una columna que se agrega a la migración y no acá (o al revés) la rompe.
 */
export const COLUMNAS_DE_SALDOS = {
  clase_de_asiento: ["sentido", "clase", "signo", "exige_detalle", "admite_vencimiento"],
  asiento_de_saldo: [
    "id",
    "empresa_id",
    "parte_id",
    "sentido",
    "clase",
    "naturaleza",
    "importe",
    "moneda",
    "origen_tipo",
    "origen_id",
    "origen_orden",
    "referencia_tipo",
    "referencia_id",
    "vence_el",
    "detalle",
    "anula_a",
    "clave_idempotencia",
    "huella",
    "hecho_en",
    "registrado_en",
    "fecha_negocio",
    "registrado_por",
  ],
  distribucion_de_asiento: ["id", "empresa_id", "asiento_id", "sucursal_id", "importe", "moneda"],
  imputacion_de_saldo: [
    "id",
    "empresa_id",
    "numero",
    "saldante_id",
    "saldado_id",
    "parte_id",
    "sentido",
    "importe",
    "moneda",
    "clave_idempotencia",
    "huella",
    "registrado_en",
    "registrado_por",
  ],
  saldo_de_asiento: ["empresa_id", "asiento_id", "tope", "importe_imputado", "anulado"],
  saldo_de_imputacion: ["empresa_id", "saldante_id", "saldado_id", "importe"],
  saldo_de_parte: ["empresa_id", "parte_id", "sentido", "moneda", "saldo"],
  saldo_de_parte_por_centro_de_costo: [
    "id",
    "empresa_id",
    "parte_id",
    "sentido",
    "moneda",
    "sucursal_id",
    "saldo",
  ],
} as const satisfies { [T in keyof SaldosDb]: readonly (keyof SaldosDb[T])[] };
