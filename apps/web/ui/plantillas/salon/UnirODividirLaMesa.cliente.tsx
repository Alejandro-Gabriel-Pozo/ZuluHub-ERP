"use client";

import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import type { Accion, AccionesDelServidorDeLaMesa } from "./acciones-de-la-mesa";
import { DividirLaMesa } from "./DividirLaMesa.cliente";
import type { MesaArmada, MesaParaUnir, TextosDeLaMesa } from "./modelo-de-la-mesa";
import type { TextosDeDividir } from "./textos-de-dividir";
import { UnirLaMesa } from "./UnirLaMesa.cliente";

export type PropsDeUnirODividirLaMesa = Readonly<{
  mesa: MesaArmada;
  textos: TextosDeLaMesa;
  textosDeDividir: TextosDeDividir;
  /** Lo que la persona puede hacer (solo ayudas: el servidor decide). */
  puede: Readonly<{ unir: boolean; dividir: boolean }>;
  /** Las mesas a las que se puede unir esta; `null` si no se pudieron leer: no se ofrece unir. */
  mesasParaUnir: readonly MesaParaUnir[] | null;
  ocupado: boolean;
  error: ErrorPublico | null;
  acciones: Pick<AccionesDelServidorDeLaMesa, "unir" | "dividir">;
  /** La guarda de la pantalla: un pedido a la vez; `alTerminar` solo si salió bien. */
  ejecutar: (accion: Accion, pedido: unknown, alTerminar: () => void) => Promise<void>;
  alUnida: (destino: MesaParaUnir) => void;
  alDividida: () => void;
}>;

/** «Unir con otra mesa» y «Dividir la cuenta» de la mesa con cuenta (SAL-E1 y SAL-E2): cada uno solo a quien puede y solo con lo que el modelo ofrece (con platos y todos enviados, para dividir). Sin textos propios. */
export function UnirODividirLaMesa({
  mesa,
  textos,
  textosDeDividir,
  puede,
  mesasParaUnir,
  ocupado,
  error,
  acciones,
  ejecutar,
  alUnida,
  alDividida,
}: PropsDeUnirODividirLaMesa) {
  if (mesa.cuentaId === null) return null;
  return (
    <>
      {puede.unir &&
      mesa.totalACobrar !== null &&
      mesasParaUnir !== null &&
      mesasParaUnir.length > 0 &&
      !mesa.sinPlatos ? (
        <UnirLaMesa
          cuentaId={mesa.cuentaId}
          total={mesa.totalACobrar}
          candidatas={mesasParaUnir}
          textos={textos}
          ocupado={ocupado}
          error={error}
          unir={(pedido, alTerminar) => {
            void ejecutar(acciones.unir, pedido, alTerminar);
          }}
          alUnida={alUnida}
        />
      ) : null}
      {puede.dividir && mesa.paraDividir.length > 0 ? (
        <DividirLaMesa
          cuentaId={mesa.cuentaId}
          lineas={mesa.paraDividir}
          textos={textosDeDividir}
          ocupado={ocupado}
          error={error}
          dividir={(pedido, alTerminar) => {
            void ejecutar(acciones.dividir, pedido, alTerminar);
          }}
          alDividida={alDividida}
        />
      ) : null}
    </>
  );
}
