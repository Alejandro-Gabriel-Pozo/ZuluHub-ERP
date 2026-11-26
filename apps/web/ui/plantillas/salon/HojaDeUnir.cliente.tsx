"use client";

import { useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../patrones/Superposicion";
import { cuantoQuedaAlUnir, type MesaParaUnir } from "./modelo-de-la-mesa";
import estilos from "./PantallaDeLaMesa.module.css";

export type PropsDeHojaDeUnir = Readonly<{
  /** El total de la mesa que se une (la actual): con el del destino sale «Cuánto queda». */
  total: Readonly<{ moneda: string; monto: string }>;
  candidatas: readonly MesaParaUnir[];
  textos: Readonly<{
    unirConOtraMesa: string;
    confirmarUnion: string;
    cuantoQueda: string;
    noSeDeshace: string;
    noSePuedenUnir: string;
    cancelar: string;
    cerrar: string;
  }>;
  /** Hay un pedido en vuelo: la hoja no se cierra ni se manda otra vez. */
  ocupado: boolean;
  /** El rechazo del servidor, dentro de la hoja (la pantalla de atrás queda inerte). */
  error: ErrorPublico | null;
  alConfirmar: (destino: MesaParaUnir) => void;
  alCancelar: () => void;
}>;

/**
 * Unir con otra mesa (SAL-E1, S10; maqueta `unir.html`): se elige la mesa destino, se ve «Cuánto queda» (la suma exacta de las dos cuentas) con el aviso de que no se deshace, y «Confirmar unión». Los motivos de «No se pueden
 * unir» salen del servidor (con su texto aprobado o sin motivo) bajo ese título. Sin textos propios: todos llegan resueltos.
 */
export function HojaDeUnir({
  total,
  candidatas,
  textos,
  ocupado,
  error,
  alConfirmar,
  alCancelar,
}: PropsDeHojaDeUnir) {
  const [elegida, setElegida] = useState<MesaParaUnir | null>(null);
  const queda = elegida === null ? null : cuantoQuedaAlUnir(total, elegida.total);
  return (
    <Superposicion
      abierta
      titulo={textos.unirConOtraMesa}
      proposito="elegir"
      alCerrar={alCancelar}
      cerrable={!ocupado}
      etiquetaDeCerrar={textos.cerrar}
    >
      <ul className={estilos["destinos"]}>
        {candidatas.map((c) => (
          <li key={c.mesaId}>
            <Boton
              variante={elegida?.mesaId === c.mesaId ? "primaria" : "secundaria"}
              deshabilitado={ocupado}
              alTocar={() => {
                setElegida(c);
              }}
            >
              {c.titulo}
            </Boton>
          </li>
        ))}
      </ul>
      {elegida === null || queda === null ? null : (
        <div className={estilos["hoja"]}>
          <p className={estilos["total"]}>
            <span>{textos.cuantoQueda}</span>
            <strong>{queda}</strong>
          </p>
          <p>{textos.noSeDeshace}</p>
          {error === null ? null : (
            <Aviso tono="peligro" titulo={textos.noSePuedenUnir}>
              <ErrorDeRespuesta error={error} />
            </Aviso>
          )}
          <div className={estilos["acciones"]}>
            <Boton variante="secundaria" deshabilitado={ocupado} alTocar={alCancelar}>
              {textos.cancelar}
            </Boton>
            <Boton
              enviando={ocupado}
              alTocar={() => {
                alConfirmar(elegida);
              }}
            >
              {textos.confirmarUnion}
            </Boton>
          </div>
        </div>
      )}
    </Superposicion>
  );
}
