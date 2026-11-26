"use client";

import { Boton } from "../../componentes/Boton.cliente";
import {
  conLaCuentaCompartida,
  conLaCuentaDelPaso,
  conLaCuentaEntera,
  conLaForma,
  type Borrador,
  type Forma,
  type LineaParaDividir,
} from "./modelo-de-dividir";
import estilos from "./PantallaDeLaMesa.module.css";
import { conNumero, type TextosDeDividir } from "./textos-de-dividir";

export type PropsDeLineaDeLaDivision = Readonly<{
  linea: LineaParaDividir;
  borrador: Borrador;
  textos: TextosDeDividir;
  /** La línea todavía no se repartió del todo: dice «Falta asignar». */
  sinAsignar: boolean;
  ocupado: boolean;
  alCambiar: (borrador: Borrador) => void;
}>;

/** Las cuentas entre las que se elige: un botón por cuenta, encendido el elegido (`aria-pressed`). */
function Cuentas({
  cuentas,
  cuentaN,
  elegida,
  ocupado,
  alElegir,
}: Readonly<{
  cuentas: number;
  cuentaN: string;
  elegida: (parte: number) => boolean;
  ocupado: boolean;
  alElegir: (parte: number) => void;
}>) {
  return (
    <div className={estilos["opciones"]}>
      {Array.from({ length: cuentas }, (_, i) => i + 1).map((parte) => (
        <Boton
          key={parte}
          variante={elegida(parte) ? "primaria" : "secundaria"}
          presionado={elegida(parte)}
          deshabilitado={ocupado}
          alTocar={() => {
            alElegir(parte);
          }}
        >
          {conNumero(cuentaN, parte)}
        </Boton>
      ))}
    </div>
  );
}

/**
 * Una línea de la cuenta en la hoja de «Dividir» (SAL-E2, S11): «Entero» a una cuenta, «Por unidades» (cada unidad a una cuenta) o «Compartido» en partes iguales entre las cuentas elegidas. Mientras no está repartida del todo dice
 * «Falta asignar» (el estado comunica el motivo). Sin textos propios: todos llegan resueltos; el reparto en sí es del modelo.
 */
export function LineaDeLaDivision({
  linea,
  borrador,
  textos,
  sinAsignar,
  ocupado,
  alCambiar,
}: PropsDeLineaDeLaDivision) {
  const reparto = borrador.repartos[linea.lineaId];
  const formas: readonly Readonly<{ forma: Forma; rotulo: string; apagada: boolean }>[] = [
    { forma: "ENTERO", rotulo: textos.entero, apagada: false },
    { forma: "POR_UNIDADES", rotulo: textos.porUnidades, apagada: linea.pasos === null },
    { forma: "COMPARTIDO", rotulo: textos.compartido, apagada: false },
  ];
  return (
    <li className={estilos["plato"]}>
      <div className={estilos["datos"]}>
        <span>
          {linea.nombre} · {linea.importe}
        </span>
        {sinAsignar ? <span className={estilos["nota"]}>{textos.faltaAsignar}</span> : null}
      </div>
      <div className={estilos["hoja"]}>
        <span className={estilos["nota"]}>{textos.repartir}</span>
        <div className={estilos["opciones"]}>
          {formas.map((f) => (
            <Boton
              key={f.forma}
              variante={reparto?.forma === f.forma ? "primaria" : "secundaria"}
              presionado={reparto?.forma === f.forma}
              deshabilitado={ocupado || f.apagada}
              alTocar={() => {
                alCambiar(conLaForma(borrador, linea, f.forma));
              }}
            >
              {f.rotulo}
            </Boton>
          ))}
        </div>
        {reparto?.forma === "ENTERO" ? (
          <Cuentas
            cuentas={borrador.cuentas}
            cuentaN={textos.cuentaN}
            ocupado={ocupado}
            elegida={(p) => reparto.parte === p}
            alElegir={(p) => {
              alCambiar(conLaCuentaEntera(borrador, linea, p));
            }}
          />
        ) : null}
        {reparto?.forma === "POR_UNIDADES"
          ? reparto.pasos.map((cuenta, paso) => (
              // Una fila por unidad (el orden es fijo: la fila N es siempre la unidad N).
              <div key={paso} className={estilos["opciones"]}>
                <span>{String(paso + 1)}</span>
                <Cuentas
                  cuentas={borrador.cuentas}
                  cuentaN={textos.cuentaN}
                  ocupado={ocupado}
                  elegida={(p) => cuenta === p}
                  alElegir={(p) => {
                    alCambiar(conLaCuentaDelPaso(borrador, linea, paso, p));
                  }}
                />
              </div>
            ))
          : null}
        {reparto?.forma === "COMPARTIDO" ? (
          <>
            <span className={estilos["nota"]}>{textos.entreCuales}</span>
            <Cuentas
              cuentas={borrador.cuentas}
              cuentaN={textos.cuentaN}
              ocupado={ocupado}
              elegida={(p) => reparto.partes.includes(p)}
              alElegir={(p) => {
                alCambiar(conLaCuentaCompartida(borrador, linea, p));
              }}
            />
            <span className={estilos["nota"]}>{textos.centavoQueSobra}</span>
          </>
        ) : null}
      </div>
    </li>
  );
}
