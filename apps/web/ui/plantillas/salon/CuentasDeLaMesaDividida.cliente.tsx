"use client";

import { Boton } from "../../componentes/Boton.cliente";
import type { CuentaHijaArmada } from "./modelo-de-dividir";
import estilos from "./PantallaDeLaMesa.module.css";
import type { TextosDeDividir } from "./textos-de-dividir";

export type PropsDeCuentasDeLaMesaDividida = Readonly<{
  cuentas: readonly CuentaHijaArmada[];
  textos: Pick<TextosDeDividir, "pendiente" | "cobrada" | "cobrar">;
  /** «Cobrar» se ofrece solo a quien puede (ayuda: el servidor decide). */
  puedeCobrar: boolean;
  ocupado: boolean;
  alCobrar: (cuenta: CuentaHijaArmada) => void;
}>;

/**
 * Las cuentas de una mesa dividida (SAL-E2, S9): «Cuenta N · importe · Pendiente» o «Cobrada», y «Cobrar» en cada una que está lista (sin cobrar y con todos sus platos enviados: el estado comunica el motivo). Cada cuenta se
 * cobra sola, con su ticket; al cobrar la última la mesa queda libre. Sin textos propios: todos llegan resueltos.
 */
export function CuentasDeLaMesaDividida({
  cuentas,
  textos,
  puedeCobrar,
  ocupado,
  alCobrar,
}: PropsDeCuentasDeLaMesaDividida) {
  return (
    <ul className={estilos["cuentas"]}>
      {cuentas.map((c) => (
        <li key={c.cuentaId} className={estilos["plato"]}>
          <span className={estilos["datos"]}>
            {c.titulo}
            {c.importe === null ? "" : ` · ${c.importe}`}
            {` · ${c.cobrada ? textos.cobrada : textos.pendiente}`}
          </span>
          {puedeCobrar && c.cobrable ? (
            <Boton
              deshabilitado={ocupado}
              alTocar={() => {
                alCobrar(c);
              }}
            >
              {textos.cobrar}
            </Boton>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
