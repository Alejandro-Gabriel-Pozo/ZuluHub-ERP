"use client";

import { Aviso } from "../../componentes/Aviso";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import type { CobroPreparado } from "../cobrar/modelo-de-cobro";
import type { TextosDeCobrar } from "../cobrar/textos-de-cobrar";
import estilos from "./VentaRapida.module.css";

/**
 * El aviso de la caja en la barra de la venta (maqueta `franjaCaja`, DDD:294), encima de «Ver cuenta»: sin caja abierta, «Abrí la caja para cobrar» con «Abrir caja» solo para quien puede abrirla (DEC-0502);
 * sin permiso o con el día en cierre, el genérico. Con la caja lista no hay aviso. «Cobrar» queda apagado en los dos casos (lo decide la pantalla de venta).
 */
export function FranjaDeCaja({
  preparado,
  cobro,
}: Readonly<{
  preparado: CobroPreparado;
  cobro: Readonly<{ textos: TextosDeCobrar; rutaParaAbrirLaCaja: string | null }>;
}>) {
  if (preparado.estado === "LISTO") return null;
  return (
    <div className={estilos["franjaDeCaja"]}>
      {preparado.estado === "ABRIR_LA_CAJA" ? (
        <Aviso
          tono="aviso"
          {...(cobro.rutaParaAbrirLaCaja === null
            ? {}
            : {
                accion: (
                  <EnlaceDeAccion href={cobro.rutaParaAbrirLaCaja} variante="secundaria">
                    {cobro.textos.abrirCaja}
                  </EnlaceDeAccion>
                ),
              })}
        >
          {cobro.textos.abrirLaCaja}
        </Aviso>
      ) : (
        <Aviso tono="peligro">{cobro.textos.noPermitido}</Aviso>
      )}
    </div>
  );
}
