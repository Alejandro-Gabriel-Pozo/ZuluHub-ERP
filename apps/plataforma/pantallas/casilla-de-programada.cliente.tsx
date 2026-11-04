"use client";

import { useId } from "react";
import { Icono } from "../../web/ui/iconos/Icono";
import { LEYENDA_DE_PROGRAMADA } from "../logica/cambio-de-plan";
import { fechaArgentinaDeInstante, fechaLegible } from "../logica/vigencia";
import submarcas from "./submarcas.module.css";

export type PropsDeCasillaDeProgramada = Readonly<{
  programada: { nombreComercial: string; versionNumero: number; vigenteDesde: string };
  marcada: boolean;
  deshabilitada: boolean;
  error: string | undefined;
  alCambiar: (marcada: boolean) => void;
}>;

/** La casilla obligatoria cuando ya hay un cambio programado: el backend exige saber que existe. */
export function CasillaDeProgramada({
  programada,
  marcada,
  deshabilitada,
  error,
  alCambiar,
}: PropsDeCasillaDeProgramada) {
  const idDelError = useId();
  return (
    <div className={submarcas["casillaCaja"]}>
      <label className={submarcas["casilla"]}>
        <input
          type="checkbox"
          checked={marcada}
          disabled={deshabilitada}
          aria-required="true"
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : idDelError}
          onChange={(evento) => {
            alCambiar(evento.target.checked);
          }}
        />
        <span>Sé que hay un cambio programado y quiero seguir (obligatorio)</span>
      </label>
      <p className={submarcas["ayuda"]}>
        Ya hay un cambio programado: {programada.nombreComercial} (versión{" "}
        {programada.versionNumero}) desde{" "}
        {fechaLegible(fechaArgentinaDeInstante(programada.vigenteDesde))}. {LEYENDA_DE_PROGRAMADA}
      </p>
      {error === undefined ? null : (
        <p id={idDelError} className={submarcas["error"]}>
          <Icono clave="estado-peligro" tamano="chico" decorativo />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
