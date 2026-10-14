import type { Ambiente } from "./comprobante-nuevo";
import type { CertificadoId, EmisorId } from "./identificadores";

/**
 * Aviso de vencimiento de los certificados (spec H7 facturación §B.6.1 y decisión del dueño 2026-10-14, punto 4):
 * un certificado de ARCA dura dos años y el gerente tiene que enterarse ANTES de que venza, porque sin certificado
 * vigente no se emite. Acá solo vive la consulta pura; el mail o la pantalla que avisa son de otro tramo.
 */

/** Cuántos días antes empieza el aviso (ASUMIDO: ARCA tarda poco en emitir uno nuevo, y 30 días dan margen). */
export const DIAS_DE_AVISO_POR_DEFECTO = 30;

const MS_POR_DIA = 86_400_000;

export type CertificadoParaAvisar = Readonly<{
  id: CertificadoId;
  emisorId: EmisorId;
  ambiente: Ambiente;
  alias: string;
  estado: string;
  venceEn: Date | null;
}>;

export type AvisoDeVencimiento = Readonly<{
  certificadoId: CertificadoId;
  emisorId: EmisorId;
  ambiente: Ambiente;
  alias: string;
  venceEn: Date;
  /** Días enteros que faltan (se redondea hacia arriba: «hoy vence» son 1); 0 o menos si ya venció. */
  diasRestantes: number;
  /** `true`: ya venció y sigue siendo el vigente: hoy no se puede emitir con él. */
  vencido: boolean;
}>;

/**
 * Los certificados VIGENTES que vencen dentro de los próximos `dias` días (inclusive), y los que ya vencieron y
 * siguen como vigentes (el caso más urgente: no se calla). Primero los que vencen antes (los empates, en el orden en que vinieron).
 * Los demás estados (pedidos, reemplazados, descartados) no avisan: no se emite con ellos. Lanza `RangeError` si
 * `dias` no es un entero mayor o igual a 0 (es un defecto de quien llama).
 */
export function certificadosPorVencer(
  certificados: readonly CertificadoParaAvisar[],
  ahora: Date,
  dias: number = DIAS_DE_AVISO_POR_DEFECTO,
): AvisoDeVencimiento[] {
  if (!Number.isInteger(dias) || dias < 0) {
    throw new RangeError("los días de aviso son un entero mayor o igual a 0");
  }
  const limite = ahora.getTime() + dias * MS_POR_DIA;
  const avisos: AvisoDeVencimiento[] = [];
  for (const c of certificados) {
    if (c.estado !== "VIGENTE" || c.venceEn === null || c.venceEn.getTime() > limite) continue;
    avisos.push({
      certificadoId: c.id,
      emisorId: c.emisorId,
      ambiente: c.ambiente,
      alias: c.alias,
      venceEn: c.venceEn,
      diasRestantes: Math.ceil((c.venceEn.getTime() - ahora.getTime()) / MS_POR_DIA),
      vencido: c.venceEn.getTime() <= ahora.getTime(),
    });
  }
  // El orden es estable: los que vencen en el mismo instante quedan como vinieron.
  return avisos.sort((a, b) => a.venceEn.getTime() - b.venceEn.getTime());
}
