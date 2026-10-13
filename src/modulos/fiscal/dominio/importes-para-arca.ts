import { type Importe, importeCero, sumar } from "../../../primitivas/dinero/importe";
import { porcentajeDeAlicuota, type CodigoDeAlicuota } from "./alicuota";
import { letraDeComprobante } from "./comprobante-emitido";
import type { ComprobanteNuevo } from "./comprobante-nuevo";

/**
 * Los importes tal como los pide `FECAESolicitar` (spec H7 facturación §B.3.4), calculados desde
 * centavos: nunca pasan por `number` (el WSDL declare `double`, pero el XML se arma con texto de dos
 * decimales).
 *
 * | Letra | ImpNeto                     | ImpIVA | ImpOpEx          | ImpTotConc            | Iva[]                           |
 * | A y B | Σ netos de las gravadas     | Σ IVA  | renglones EXENTO | renglones NO_GRAVADO  | una entrada por alícuota gravada |
 * | C     | el total                    | 0      | 0                | 0                     | no se informa                    |
 *
 * Invariante (error 10048 de WSFE v4.8): `ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpTrib +
 * ImpIVA`, exacto. Sin tributos en la primera entrega, `ImpTrib` es cero.
 */
export type AlicuotaParaArca = Readonly<{
  alicuota: CodigoDeAlicuota;
  base: Importe;
  iva: Importe;
}>;

export type ImportesParaArca = Readonly<{
  total: Importe;
  neto: Importe;
  iva: Importe;
  exento: Importe;
  noGravado: Importe;
  tributos: Importe;
  alicuotas: readonly AlicuotaParaArca[];
}>;

export function importesParaArca(
  comprobante: Pick<ComprobanteNuevo, "tipo" | "total" | "desglose">,
): ImportesParaArca {
  const cero = importeCero(comprobante.total.moneda);
  if (letraDeComprobante(comprobante.tipo) === "C") {
    return {
      total: comprobante.total,
      neto: comprobante.total,
      iva: cero,
      exento: cero,
      noGravado: cero,
      tributos: cero,
      alicuotas: [],
    };
  }
  const gravadas = comprobante.desglose.filter((d) => porcentajeDeAlicuota(d.alicuota) !== null);
  const totalDe = (codigo: CodigoDeAlicuota): Importe =>
    comprobante.desglose.find((d) => d.alicuota === codigo)?.total ?? cero;
  const neto = gravadas.reduce((acumulado, d) => sumar(acumulado, d.neto), cero);
  const iva = gravadas.reduce((acumulado, d) => sumar(acumulado, d.iva), cero);
  return {
    total: comprobante.total,
    neto,
    iva,
    exento: totalDe("EXENTO"),
    noGravado: totalDe("NO_GRAVADO"),
    tributos: cero,
    alicuotas: alicuotasInformadas(gravadas, neto, iva),
  };
}

/**
 * Una entrada por alícuota gravada, sin repetir (error 10022). Con `ImpIVA` igual a cero ARCA solo
 * admite la alícuota 0 % (error 10018, l. 989): si hay IVA gravado pero todos los importes redondean
 * a cero (totales de centavos), se informa una sola entrada al 0 % con toda la base.
 */
function alicuotasInformadas(
  gravadas: readonly { alicuota: CodigoDeAlicuota; neto: Importe; iva: Importe }[],
  neto: Importe,
  iva: Importe,
): readonly AlicuotaParaArca[] {
  if (gravadas.length === 0) return [];
  if (iva.unidades === 0n) return [{ alicuota: "0", base: neto, iva }];
  return gravadas.map((d) => ({ alicuota: d.alicuota, base: d.neto, iva: d.iva }));
}
