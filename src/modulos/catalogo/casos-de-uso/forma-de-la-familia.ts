/**
 * La regla única de cómo sale una familia en la carta, para las consultas: las consultas por pantalla no importan el dominio (ADR-005), así que la leen por acá. No agrega
 * nada: es la misma `formaDeFamilia` (`dominio/forma-de-familia.ts`).
 */
export {
  formaDeFamilia,
  type FormaDeFamilia,
  type MiembroParaForma,
} from "../dominio/forma-de-familia";
