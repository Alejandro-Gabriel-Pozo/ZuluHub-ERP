"use client";

import { useState } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { Superposicion } from "../../patrones/Superposicion";
import estilos from "./PantallaDeLaMesa.module.css";

type Envio = Readonly<{ envioId: string; titulo: string }>;

export type PropsDeEnviosDeLaMesa = Readonly<{
  envios: readonly Envio[];
  textos: Readonly<{
    reimprimir: string;
    seImprimeUnaCopia: string;
    cancelar: string;
    cerrar: string;
  }>;
  ocupado: boolean;
  /** Confirmada la copia: la pantalla la pide al servidor (que la hace con la hora del envío original). */
  alCopiar: (envio: Envio) => void;
}>;

/** Los envíos de la cuenta con su «Reimprimir»: tocarlo pide confirmar («Se imprime una copia con la hora del envío original») y recién ahí se pide la copia. */
export function EnviosDeLaMesa({ envios, textos, ocupado, alCopiar }: PropsDeEnviosDeLaMesa) {
  const [copiando, setCopiando] = useState<Envio | null>(null);
  return (
    <>
      <ul className={estilos["envios"]}>
        {envios.map((e) => (
          <li key={e.envioId} className={estilos["envio"]}>
            <span>{e.titulo}</span>
            <Boton
              variante="secundaria"
              deshabilitado={ocupado}
              alTocar={() => {
                setCopiando(e);
              }}
            >
              {textos.reimprimir}
            </Boton>
          </li>
        ))}
      </ul>
      <Superposicion
        abierta={copiando !== null}
        titulo={copiando?.titulo ?? ""}
        proposito="confirmar"
        alCerrar={() => {
          setCopiando(null);
        }}
        cerrable
        etiquetaDeCerrar={textos.cerrar}
      >
        <div className={estilos["hoja"]}>
          <p>{textos.seImprimeUnaCopia}</p>
          <div className={estilos["acciones"]}>
            <Boton
              variante="secundaria"
              alTocar={() => {
                setCopiando(null);
              }}
            >
              {textos.cancelar}
            </Boton>
            <Boton
              alTocar={() => {
                if (copiando !== null) alCopiar(copiando);
                setCopiando(null);
              }}
            >
              {textos.reimprimir}
            </Boton>
          </div>
        </div>
      </Superposicion>
    </>
  );
}
