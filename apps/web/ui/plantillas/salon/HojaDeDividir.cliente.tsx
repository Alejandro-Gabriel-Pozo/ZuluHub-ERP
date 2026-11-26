"use client";

import { useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import type { Asignacion } from "../../../../../src/primitivas/cuentas/division";
import { Boton } from "../../componentes/Boton.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../patrones/Superposicion";
import { LineaDeLaDivision } from "./LineaDeLaDivision.cliente";
import {
  BORRADOR_INICIAL,
  conUnaCuentaMas,
  evaluarLaDivision,
  puedeAgregarCuenta,
  type LineaParaDividir,
} from "./modelo-de-dividir";
import estilos from "./PantallaDeLaMesa.module.css";
import { conNumero, type TextosDeDividir } from "./textos-de-dividir";

export type PropsDeHojaDeDividir = Readonly<{
  lineas: readonly LineaParaDividir[];
  textos: TextosDeDividir;
  /** Hay un pedido en vuelo: la hoja no se cierra ni se manda otra vez. */
  ocupado: boolean;
  /** El rechazo del servidor, dentro de la hoja (la pantalla de atrás queda inerte). */
  error: ErrorPublico | null;
  alConfirmar: (cuentas: number, asignaciones: readonly Asignacion[]) => void;
  alCancelar: () => void;
}>;

/**
 * Dividir la cuenta por ítems (SAL-E2, S11; maquetas `salon.html` y `unir.html`): las cuentas con lo que suma cada una, cada línea repartida («Entero», «Por unidades» o «Compartido»), «Agregar cuenta» hasta el máximo y «Confirmar
 * división», que solo se puede tocar con todo repartido y ninguna cuenta vacía (el motivo se ve en «Falta asignar» y «Cuenta vacía»). Los importes salen del modelo, con la misma regla que valida el servidor. Sin textos propios.
 */
export function HojaDeDividir({
  lineas,
  textos,
  ocupado,
  error,
  alConfirmar,
  alCancelar,
}: PropsDeHojaDeDividir) {
  const [borrador, setBorrador] = useState(BORRADOR_INICIAL);
  const evaluacion = evaluarLaDivision(borrador, lineas);
  return (
    <Superposicion
      abierta
      titulo={textos.dividirPorItems}
      proposito="editar"
      alCerrar={alCancelar}
      cerrable={!ocupado}
      etiquetaDeCerrar={textos.cerrar}
    >
      <div className={estilos["hoja"]}>
        <h3 className={estilos["subtitulo"]}>{textos.cuentas}</h3>
        <ul className={estilos["cuentas"]}>
          {Array.from({ length: borrador.cuentas }, (_, i) => i + 1).map((n) => (
            <li key={n}>
              {conNumero(textos.cuentaN, n)}
              {evaluacion.totales === null ? "" : ` · ${evaluacion.totales[n - 1] ?? ""}`}
              {evaluacion.vacias.includes(n) ? ` · ${textos.cuentaVacia}` : ""}
            </li>
          ))}
        </ul>
        {puedeAgregarCuenta(borrador) ? (
          <div className={estilos["acciones"]}>
            <Boton
              variante="secundaria"
              deshabilitado={ocupado}
              alTocar={() => {
                setBorrador(conUnaCuentaMas(borrador));
              }}
            >
              {textos.agregarCuenta}
            </Boton>
          </div>
        ) : null}
        <ul className={estilos["platos"]}>
          {lineas.map((l) => (
            <LineaDeLaDivision
              key={l.lineaId}
              linea={l}
              borrador={borrador}
              textos={textos}
              sinAsignar={evaluacion.sinAsignar.has(l.lineaId)}
              ocupado={ocupado}
              alCambiar={setBorrador}
            />
          ))}
        </ul>
        {error === null ? null : <ErrorDeRespuesta error={error} />}
        <div className={estilos["acciones"]}>
          <Boton variante="secundaria" deshabilitado={ocupado} alTocar={alCancelar}>
            {textos.cancelar}
          </Boton>
          <Boton
            deshabilitado={!evaluacion.lista}
            enviando={ocupado}
            alTocar={() => {
              alConfirmar(borrador.cuentas, evaluacion.asignaciones);
            }}
          >
            {textos.confirmarDivision}
          </Boton>
        </div>
      </div>
    </Superposicion>
  );
}
