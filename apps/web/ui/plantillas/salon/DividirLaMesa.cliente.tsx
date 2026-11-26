"use client";

import { useRef, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import type { Asignacion } from "../../../../../src/primitivas/cuentas/division";
import { Boton } from "../../componentes/Boton.cliente";
import { HojaDeDividir } from "./HojaDeDividir.cliente";
import type { LineaParaDividir } from "./modelo-de-dividir";
import estilos from "./PantallaDeLaMesa.module.css";
import type { TextosDeDividir } from "./textos-de-dividir";

export type PropsDeDividirLaMesa = Readonly<{
  /** La cuenta de la mesa actual: es la MADRE (sus ítems pasan a las cuentas hijas). */
  cuentaId: string;
  lineas: readonly LineaParaDividir[];
  textos: TextosDeDividir;
  ocupado: boolean;
  error: ErrorPublico | null;
  /** Manda la división (la pantalla la corre con su guarda de «un pedido a la vez»); `alTerminar` solo si salió bien. */
  dividir: (pedido: unknown, alTerminar: () => void) => void;
  /** La división se hizo: la pantalla se recarga y muestra las cuentas. */
  alDividida: () => void;
}>;

const nuevoId = (): string => crypto.randomUUID();

/**
 * «Dividir la cuenta» en la ficha (SAL-E2): el botón y su hoja. El id de la división es de UN intento: se fija al confirmar y se REPITE si se repite exactamente lo mismo tras un corte (el servidor devuelve las mismas cuentas, no
 * otras); confirmar otro reparto es otro intento. Sin textos propios: todos llegan resueltos.
 */
export function DividirLaMesa({
  cuentaId,
  lineas,
  textos,
  ocupado,
  error,
  dividir,
  alDividida,
}: PropsDeDividirLaMesa) {
  const [abierta, setAbierta] = useState(false);
  const intento = useRef<Readonly<{ huella: string; divisionId: string }> | null>(null);
  return (
    <div className={estilos["acciones"]}>
      <Boton
        variante="secundaria"
        deshabilitado={ocupado}
        alTocar={() => {
          setAbierta(true);
        }}
      >
        {textos.dividirLaCuenta}
      </Boton>
      {abierta ? (
        <HojaDeDividir
          lineas={lineas}
          textos={textos}
          ocupado={ocupado}
          error={error}
          alCancelar={() => {
            setAbierta(false);
          }}
          alConfirmar={(partes: number, asignaciones: readonly Asignacion[]) => {
            const huella = JSON.stringify([partes, asignaciones]);
            if (intento.current?.huella !== huella) {
              intento.current = { huella, divisionId: nuevoId() };
            }
            const { divisionId } = intento.current;
            dividir({ divisionId, cuentaId, partes, asignaciones }, () => {
              intento.current = null;
              setAbierta(false);
              alDividida();
            });
          }}
        />
      ) : null}
    </div>
  );
}
