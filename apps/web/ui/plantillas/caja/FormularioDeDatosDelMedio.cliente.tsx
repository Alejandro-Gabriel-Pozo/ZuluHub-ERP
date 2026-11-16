"use client";

import { useState } from "react";
import { Casilla } from "../../componentes/Casilla";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeConfiguracion } from "./FormularioDeConfiguracion.cliente";
import estilos from "./FormularioDeDatosDelMedio.module.css";

/** Un dato que el tipo del medio admite, con su rótulo ya resuelto y si hoy se pide. */
type CasillaDeDato = Readonly<{ dato: string; etiqueta: string; pide: boolean }>;

export type PropsDeFormularioDeDatosDelMedio = Readonly<{
  casillas: readonly CasillaDeDato[];
  /** `cambiarLosDatosDelMedioAccion` ya ligada al id y la versión del medio. */
  accion: AccionDeFormulario;
  textos: Readonly<{ titulo: string; guardar: string }>;
  /** Si el servidor deja guardar hoy: si no, las casillas y «Guardar» salen apagadas (solo una ayuda: el guard decide). */
  puedeGuardar: boolean;
}>;

/**
 * «Datos que se piden al cobrar» de un medio de pago (maqueta `datos-cobro.html`, 09/11/2026): una casilla por cada dato que el tipo admite; tildada, el dato aparece al
 * cobrar. Manda el conjunto final de los tildados (campo `datos`, un valor por casilla). Qué datos admite cada tipo lo decide el servidor (llegan ya filtrados): acá no se repite.
 */
export function FormularioDeDatosDelMedio({
  casillas,
  accion,
  textos,
  puedeGuardar,
}: PropsDeFormularioDeDatosDelMedio) {
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(
    () => new Set(casillas.filter((c) => c.pide).map((c) => c.dato)),
  );
  return (
    <FormularioDeConfiguracion
      accion={accion}
      textoGuardar={textos.guardar}
      puedeGuardar={puedeGuardar}
    >
      <fieldset className={estilos["grupo"]}>
        <legend className={estilos["titulo"]}>{textos.titulo}</legend>
        {casillas.map((c) => (
          <Casilla
            key={c.dato}
            dato="estado-de-dato-del-cobro-del-medio"
            etiqueta={c.etiqueta}
            nombre="datos"
            valor={c.dato}
            marcada={marcados.has(c.dato)}
            deshabilitada={!puedeGuardar}
            alCambiar={(marcada) => {
              setMarcados((previo) => {
                const siguiente = new Set(previo);
                if (marcada) siguiente.add(c.dato);
                else siguiente.delete(c.dato);
                return siguiente;
              });
            }}
          />
        ))}
      </fieldset>
    </FormularioDeConfiguracion>
  );
}
