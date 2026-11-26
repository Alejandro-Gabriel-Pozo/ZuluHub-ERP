"use client";

import { useRef, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { HojaDeUnir, type PropsDeHojaDeUnir } from "./HojaDeUnir.cliente";
import type { MesaParaUnir } from "./modelo-de-la-mesa";
import estilos from "./PantallaDeLaMesa.module.css";

export type PropsDeUnirLaMesa = Readonly<{
  /** La cuenta de la mesa actual: es el ORIGEN (sus ítems pasan a la mesa que se elija). */
  cuentaId: string;
  total: PropsDeHojaDeUnir["total"];
  candidatas: readonly MesaParaUnir[];
  textos: PropsDeHojaDeUnir["textos"];
  ocupado: boolean;
  error: ErrorPublico | null;
  /** Manda la unión (la pantalla la corre con su guarda de «un pedido a la vez»); `alTerminar` solo si salió bien. */
  unir: (pedido: unknown, alTerminar: () => void) => void;
  /** La unión se hizo: la pantalla va a la mesa destino. */
  alUnida: (destino: MesaParaUnir) => void;
}>;

const nuevoId = (): string => crypto.randomUUID();

/**
 * «Unir con otra mesa» en la ficha (SAL-E1): el botón y su hoja. El id de la unión y la clave son de UN intento: se fijan al confirmar con una mesa y se REPITEN si se repite lo mismo tras un corte (el servidor devuelve la
 * misma unión, los ítems pasan una vez); elegir otra mesa es otro intento. Sin textos propios: todos llegan resueltos.
 */
export function UnirLaMesa({
  cuentaId,
  total,
  candidatas,
  textos,
  ocupado,
  error,
  unir,
  alUnida,
}: PropsDeUnirLaMesa) {
  const [abierta, setAbierta] = useState(false);
  const intento = useRef<Readonly<{ destinoId: string; unionId: string; clave: string }> | null>(
    null,
  );
  return (
    <div className={estilos["acciones"]}>
      <Boton
        variante="secundaria"
        deshabilitado={ocupado}
        alTocar={() => {
          setAbierta(true);
        }}
      >
        {textos.unirConOtraMesa}
      </Boton>
      {abierta ? (
        <HojaDeUnir
          total={total}
          candidatas={candidatas}
          textos={textos}
          ocupado={ocupado}
          error={error}
          alCancelar={() => {
            setAbierta(false);
          }}
          alConfirmar={(destino) => {
            if (intento.current?.destinoId !== destino.cuentaId) {
              intento.current = {
                destinoId: destino.cuentaId,
                unionId: nuevoId(),
                clave: nuevoId(),
              };
            }
            const { unionId, clave } = intento.current;
            unir(
              { unionId, cuentaDestinoId: destino.cuentaId, cuentaOrigenId: cuentaId, clave },
              () => {
                intento.current = null;
                setAbierta(false);
                alUnida(destino);
              },
            );
          }}
        />
      ) : null}
    </div>
  );
}
