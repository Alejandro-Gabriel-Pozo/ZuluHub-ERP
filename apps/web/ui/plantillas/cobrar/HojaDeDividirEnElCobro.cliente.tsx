"use client";

import { useEffect, useId, useRef, useState } from "react";
import { REGLA_DE_PORCENTAJE_DE_LA_PARTE } from "../../../../../src/capacidades/experiencia/reglas-de-cantidad";
import {
  agregarParte,
  escribirPorcentaje,
  importesParaElCobro,
  quitarParte,
  repartoInicial,
  vistaDelReparto,
  type RepartoEnEdicion,
} from "../../../../../src/primitivas/cuentas/reparto-por-porcentaje";
import { Boton } from "../../componentes/Boton.cliente";
import { BotonIcono } from "../../componentes/BotonIcono";
import { CampoNumero } from "../../componentes/CampoNumero";
import { formatearImporte } from "../../patrones/formato-fiscal";
import estilos from "./Cobrar.module.css";
import type { TextosDeCobrar } from "./textos-de-cobrar";
import type { TextosDeDividirEnElCobro } from "./textos-de-dividir-en-el-cobro";

export type PropsDeHojaDeDividirEnElCobro = Readonly<{
  /** El total de la cuenta que se cobra: lo que reparte la hoja (el servidor igual exige que los cobros sumen el total al centavo). */
  total: Readonly<{ moneda: string; monto: string }>;
  textos: TextosDeCobrar;
  textosDeDividir: TextosDeDividirEnElCobro;
  /** Pasa los importes de las partes (en orden) a las filas de cobro: no cobra nada. */
  alUsar: (importes: readonly string[]) => void;
  alVolver: () => void;
}>;

/**
 * La hoja «Por porcentaje» del cobro de una mesa (SAL-E3; maqueta `salon.html`): la parte 1 es el resto hasta 100 %, las demás se agregan con su porcentaje (2 decimales; al principio, partes iguales). «Usar en el cobro» solo pasa los
 * importes a las filas de cobro (cada parte con su medio): dividir por porcentaje es UN ticket con varios cobros, no divide datos. La regla del reparto y del centavo es la de `reparto-por-porcentaje.ts`; el servidor no confía en lo que
 * propone la pantalla: comprueba que los cobros sumen el total al centavo. Sin textos propios: todos llegan resueltos.
 */
export function HojaDeDividirEnElCobro({
  total,
  textos,
  textosDeDividir,
  alUsar,
  alVolver,
}: PropsDeHojaDeDividirEnElCobro) {
  const [reparto, setReparto] = useState<RepartoEnEdicion>(repartoInicial);
  const idDelTitulo = useId();
  const tituloRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    tituloRef.current?.focus();
  }, []);
  const vista = vistaDelReparto(total.monto, reparto);

  return (
    <section className={estilos["vista"]} aria-labelledby={idDelTitulo}>
      <header className={estilos["encabezado"]}>
        <BotonIcono etiqueta={textos.volverAlCobro} icono="atras" alTocar={alVolver} />
        <h2 id={idDelTitulo} ref={tituloRef} tabIndex={-1} className={estilos["titulo"]}>
          {textosDeDividir.porPorcentaje}
        </h2>
      </header>
      <div className={estilos["cuerpo"]}>
        <p className={estilos["total"]}>
          <span>{textos.total}</span>
          <strong>{formatearImporte(total.monto)}</strong>
        </p>
        {vista.partes.map((parte) => (
          <div key={parte.parte} className={estilos["fila"]}>
            <div className={estilos["medioEImporte"]}>
              {parte.parte === 1 ? (
                <p>
                  <span>
                    {textosDeDividir.parte} 1 ({textosDeDividir.resto})
                  </span>{" "}
                  <strong>{parte.porcentaje === null ? "" : `${parte.porcentaje} %`}</strong>
                </p>
              ) : (
                <CampoNumero
                  dato="porcentaje-de-la-parte"
                  etiqueta={`${textosDeDividir.parte} ${parte.parte} (%)`}
                  valor={reparto.porcentajes[parte.parte - 2] ?? ""}
                  alCambiar={(valor) => {
                    setReparto((previo) => escribirPorcentaje(previo, parte.parte - 2, valor));
                  }}
                  regla={REGLA_DE_PORCENTAJE_DE_LA_PARTE}
                />
              )}
              <p>
                <span>{textos.importe}</span>{" "}
                <strong>{parte.importe === null ? "" : formatearImporte(parte.importe)}</strong>
              </p>
            </div>
            {parte.parte === 1 ? null : (
              <div className={estilos["quitar"]}>
                <Boton
                  variante="secundaria"
                  alTocar={() => {
                    setReparto((previo) => quitarParte(previo, parte.parte - 2));
                  }}
                >
                  {textos.quitar}
                </Boton>
              </div>
            )}
          </div>
        ))}
        <Boton
          variante="secundaria"
          deshabilitado={!vista.puedeAgregar}
          alTocar={() => {
            setReparto((previo) => agregarParte(previo));
          }}
        >
          {textosDeDividir.agregarParte}
        </Boton>
      </div>
      <div className={estilos["pie"]}>
        <Boton
          ancho="completo"
          deshabilitado={!vista.utilizable}
          alTocar={() => {
            const importes = importesParaElCobro(total.monto, reparto);
            if (importes !== null) alUsar(importes);
          }}
        >
          {textosDeDividir.usarEnElCobro}
        </Boton>
      </div>
    </section>
  );
}
