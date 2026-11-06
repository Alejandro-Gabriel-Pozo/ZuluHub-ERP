"use client";

import { useCallback, useMemo, useState } from "react";
import type { DiccionarioResuelto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { EstiloDePagina } from "./EstiloDePagina";
import { ANCHO_A4_MM, ANCHO_TICKET_MM, mmAPx } from "./geometria";
import { HojasA4 } from "./HojasA4";
import { altoFijoDelPie, entradaDelPaginador, medidasIguales, type Medidas } from "./medicion";
import { MedidorDeLaHoja } from "./MedidorDeLaHoja.cliente";
import {
  armarLaHoja,
  type ComprobanteParaLaHoja,
  type FormatoDeImpresion,
} from "./modelo-de-la-hoja";
import { paginar } from "./paginador";
import { MARCA_DE_LA_ZONA } from "./regla-de-pagina";
import { TicketDe80mm } from "./TicketDe80mm.cliente";
import { VistaPrevia } from "./VistaPrevia.cliente";

export type PropsDeComprobanteImpreso = Readonly<{
  comprobante: ComprobanteParaLaHoja;
  /** El QR ya dibujado (SVG como texto): se muestra como imagen. */
  qrSvg: string;
  formato: FormatoDeImpresion;
  diccionario?: DiccionarioResuelto;
}>;

const SIN_DICCIONARIO: DiccionarioResuelto = {};

/**
 * La vista imprimible de un comprobante: la hoja A4 repartida en hojas o el ticket de 80 mm, dentro de una vista previa que la escala al
 * ancho disponible. Recibe todo por props (no lee datos): la página y el botón «Imprimir» son de la entrega siguiente. La medición
 * está FUERA de la vista previa (un `transform` falsea lo que se mide). `data-zona-de-impresion` marca lo único que sale en el papel.
 */
export function ComprobanteImpreso({
  comprobante,
  qrSvg,
  formato,
  diccionario = SIN_DICCIONARIO,
}: PropsDeComprobanteImpreso) {
  const a = useMemo(
    () => armarLaHoja(diccionario, comprobante, formato),
    [diccionario, comprobante, formato],
  );
  const [medidas, setMedidas] = useState<Medidas | null>(null);
  const alMedir = useCallback(
    (nuevas: Medidas) =>
      setMedidas((previas) => (medidasIguales(previas, nuevas) ? previas : nuevas)),
    [],
  );
  const [altoDelTicket, setAltoDelTicket] = useState<number | null>(null);
  // Medidas de otro contenido (cambió el comprobante y todavía no se volvió a medir): no se reparte con ellas.
  const paginacion = useMemo(() => {
    if (medidas === null || medidas.renglones.length !== comprobante.renglones.length) return null;
    return paginar(
      entradaDelPaginador(
        medidas,
        comprobante.renglones.map((r) => r.importe),
      ),
    );
  }, [medidas, comprobante.renglones]);
  return (
    <div {...{ [MARCA_DE_LA_ZONA]: "" }} data-formato={formato}>
      <EstiloDePagina formato={formato} altoDelTicketEnMm={altoDelTicket} />
      {formato === "A4" ? (
        <>
          <MedidorDeLaHoja a={a} qrSvg={qrSvg} diccionario={diccionario} alMedir={alMedir} />
          <VistaPrevia anchoNatural={mmAPx(ANCHO_A4_MM)}>
            {paginacion === null || medidas === null ? null : (
              <HojasA4
                a={a}
                paginacion={paginacion}
                altoDelPie={altoFijoDelPie(medidas)}
                qrSvg={qrSvg}
                diccionario={diccionario}
              />
            )}
          </VistaPrevia>
        </>
      ) : (
        <VistaPrevia anchoNatural={mmAPx(ANCHO_TICKET_MM)}>
          <TicketDe80mm a={a} qrSvg={qrSvg} alMedirElAlto={setAltoDelTicket} />
        </VistaPrevia>
      )}
    </div>
  );
}
