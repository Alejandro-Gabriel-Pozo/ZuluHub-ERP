import { restar, type Importe } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";

/**
 * «IMPUTAR A LO MÁS ANTIGUO» (decisión del dueño, 16/11, C4): es el valor PROPUESTO para repartir un pago entre los cargos abiertos, no una perilla;
 * la empresa puede elegir otro reparto. Ordena por vencimiento (los que no vencen, al final), luego por antigüedad y luego por id (así dos cargos
 * iguales siempre salen en el mismo orden), y reparte sin pasar lo pendiente de cada cargo. No redondea: los importes ya vienen en centavos.
 * Puro: sin reloj ni azar.
 */
export type CargoAbierto = Readonly<{
  id: string;
  venceEl: FechaCivil | null;
  registradoEn: Date;
  pendiente: Importe;
}>;

export type ImputacionRepartida = Readonly<{ cargoId: string; importe: Importe }>;

export type ErrorDeReparto = "IMPORTE_SUPERA_LO_ADEUDADO" | "IMPORTE_INVALIDO";

function comparar(a: CargoAbierto, b: CargoAbierto): number {
  if (a.venceEl !== b.venceEl) {
    if (a.venceEl === null) return 1;
    if (b.venceEl === null) return -1;
    return a.venceEl < b.venceEl ? -1 : 1;
  }
  const dias = a.registradoEn.getTime() - b.registradoEn.getTime();
  if (dias !== 0) return dias < 0 ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function repartirLoMasAntiguo(
  cargosAbiertos: readonly CargoAbierto[],
  importe: Importe,
): Resultado<ImputacionRepartida[], ErrorDeReparto> {
  if (importe.unidades <= 0n) return err("IMPORTE_INVALIDO");
  const reparto: ImputacionRepartida[] = [];
  let falta = importe;
  for (const cargo of [...cargosAbiertos].sort(comparar)) {
    if (falta.unidades === 0n) break;
    if (cargo.pendiente.moneda !== importe.moneda) return err("IMPORTE_INVALIDO");
    if (cargo.pendiente.unidades <= 0n) continue;
    const toma = cargo.pendiente.unidades < falta.unidades ? cargo.pendiente : falta;
    reparto.push({ cargoId: cargo.id, importe: toma });
    falta = restar(falta, toma);
  }
  if (falta.unidades > 0n) return err("IMPORTE_SUPERA_LO_ADEUDADO");
  return ok(reparto);
}
