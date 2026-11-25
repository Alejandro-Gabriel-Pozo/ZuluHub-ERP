"use client";

import { Boton } from "../../componentes/Boton.cliente";
import estilos from "./PantallaDeLaMesa.module.css";
import type { PlatoArmado, TextosDeLaMesa } from "./modelo-de-la-mesa";

export type PropsDePlatoDeLaMesa = Readonly<{
  plato: PlatoArmado;
  textos: TextosDeLaMesa;
  ocupado: boolean;
  /** Quien puede enviar a cocina ve «Pedir que salga» (en lo que espera) y «Anular» (en lo ya enviado); el servidor decide. */
  conCocina: boolean;
  alCambiarSalida: (salida: "AHORA" | "DESPUES") => void;
  alQuitar: () => void;
  alPedirQueSalga: () => void;
  alAnular: () => void;
}>;

/**
 * Un plato de la ficha de la mesa: su nombre, su importe y lo que se puede hacer según dónde esté. Sin enviar: pasa de «Sale ahora» a «Sale después» y al revés, o se quita (sin motivo). Esperando («Sale después»): además
 * «Pedir que salga». Ya enviado: «Anular» (con motivo). Todo apagado mientras otra acción está en vuelo. Sin textos propios.
 */
export function PlatoDeLaMesa({
  plato,
  textos,
  ocupado,
  conCocina,
  alCambiarSalida,
  alQuitar,
  alPedirQueSalga,
  alAnular,
}: PropsDePlatoDeLaMesa) {
  return (
    <li className={estilos["plato"]}>
      <div className={estilos["datos"]}>
        <span>{plato.nombre}</span>
        {plato.nota === "" ? null : <span className={estilos["nota"]}>{plato.nota}</span>}
      </div>
      {plato.importe === null ? null : <span className={estilos["importe"]}>{plato.importe}</span>}
      {plato.salida === null ? null : (
        <button
          type="button"
          className={estilos["salida"]}
          aria-label={`${plato.salida === "AHORA" ? textos.saleAhora : textos.saleDespues}. ${textos.cuandoSale}: ${plato.nombre}`}
          aria-disabled={ocupado ? "true" : undefined}
          onClick={() => {
            if (!ocupado) alCambiarSalida(plato.salida === "AHORA" ? "DESPUES" : "AHORA");
          }}
        >
          {plato.salida === "AHORA" ? textos.saleAhora : textos.saleDespues}
        </button>
      )}
      {conCocina && plato.salida === "DESPUES" ? (
        <Boton variante="secundaria" alTocar={alPedirQueSalga} deshabilitado={ocupado}>
          {textos.pedirQueSalga}
        </Boton>
      ) : null}
      {plato.quitable ? (
        <Boton variante="secundaria" alTocar={alQuitar} deshabilitado={ocupado}>
          {textos.quitar}
        </Boton>
      ) : null}
      {conCocina && plato.envioId !== null ? (
        <Boton variante="secundaria" alTocar={alAnular} deshabilitado={ocupado}>
          {textos.anular}
        </Boton>
      ) : null}
    </li>
  );
}
