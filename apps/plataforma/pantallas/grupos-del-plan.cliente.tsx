"use client";

import { Campo } from "../../web/ui/componentes/Campo";
import { Casilla } from "../../web/ui/componentes/Casilla";
import { Insignia } from "../../web/ui/componentes/Insignia";
import type { ValorDePerilla } from "../../../src/capacidades/planes/valores";
import {
  modulosParaElegir,
  perillasParaElegir,
  textoDelValor,
  valorDe,
} from "../logica/editor-de-plan";
import { rotuloDeModulo, rotuloDePerilla } from "../logica/plan";
import { textoDePlanes } from "../logica/textos-de-planes";
import estilos from "./planes.module.css";

/** Los módulos del catálogo como casillas: los obligatorios y los que otro pide figuran marcados y fijos (con su nota); los que están en desarrollo, etiquetados. */
export function GrupoDeModulos({
  bloqueada,
  marcados,
  elegidos,
  alCambiar,
}: Readonly<{
  bloqueada: boolean;
  /** Los módulos que el plan incluye de verdad (lo elegido más lo que se pide). */
  marcados: readonly string[];
  elegidos: readonly string[];
  alCambiar: (clave: string, marcada: boolean) => void;
}>) {
  const modulos = modulosParaElegir();
  return (
    <fieldset className={estilos["grupo"]} disabled={bloqueada}>
      <legend>{textoDePlanes("plataforma.planes.modulos")}</legend>
      <div className={estilos["rejilla"]}>
        {modulos.map((m) => {
          const marcado = marcados.includes(m.clave);
          const porOtro = !m.obligatorio && marcado && !elegidos.includes(m.clave);
          const nota = m.obligatorio
            ? textoDePlanes("plataforma.planes.siempre_incluido")
            : porOtro
              ? textoDePlanes("plataforma.planes.lo_pide_otro")
              : m.requiere.length > 0
                ? textoDePlanes("plataforma.planes.requiere", {
                    modulos: m.requiere.map(rotuloDeModulo).join(", "),
                  })
                : "";
          return (
            <div key={m.clave}>
              <Casilla
                dato="modulo-de-plan"
                etiqueta={m.rotulo}
                nombre={`modulo-${m.clave}`}
                marcada={marcado}
                apagada={m.obligatorio || porOtro}
                alCambiar={(marcada) => {
                  alCambiar(m.clave, marcada);
                }}
              />
              <span className={estilos["nota"]}>
                {m.enDesarrollo ? (
                  <Insignia tono="info">
                    {textoDePlanes("plataforma.planes.en_desarrollo")}
                  </Insignia>
                ) : null}{" "}
                {nota}
              </span>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Las perillas del catálogo: interruptor como casilla y límite como campo numérico (solo dígitos; lo que viaja es un número entero). */
export function GrupoDePerillas({
  bloqueada,
  perillas,
  limites,
  alCambiarInterruptor,
  alCambiarLimite,
}: Readonly<{
  bloqueada: boolean;
  perillas: Readonly<Record<string, ValorDePerilla>>;
  limites: Readonly<Record<string, string>>;
  alCambiarInterruptor: (clave: string, encendida: boolean) => void;
  alCambiarLimite: (clave: string, texto: string) => void;
}>) {
  return (
    <fieldset className={estilos["grupo"]} disabled={bloqueada}>
      <legend>{textoDePlanes("plataforma.planes.perillas")}</legend>
      <div className={estilos["rejilla"]}>
        {perillasParaElegir().map((p) => {
          const nota = textoDePlanes("plataforma.planes.requiere", {
            modulos: [
              rotuloDeModulo(p.modulo),
              ...(p.requiere === null ? [] : [rotuloDePerilla(p.requiere)]),
            ].join(", "),
          });
          const valor = valorDe(perillas, p.clave);
          return (
            <div key={p.clave}>
              {p.tipo === "INTERRUPTOR" ? (
                <Casilla
                  dato="perilla-de-plan"
                  etiqueta={p.rotulo}
                  nombre={`perilla-${p.clave}`}
                  marcada={valor.tipo === "INTERRUPTOR" && valor.encendida}
                  alCambiar={(marcada) => {
                    alCambiarInterruptor(p.clave, marcada);
                  }}
                />
              ) : (
                <Campo
                  dato="limite-de-perilla-de-plan"
                  etiqueta={p.rotulo}
                  nombre={`perilla-${p.clave}`}
                  inputMode="numeric"
                  autoComplete="off"
                  valor={limites[p.clave] ?? ""}
                  alCambiar={(v) => {
                    alCambiarLimite(p.clave, v);
                  }}
                  ayuda={
                    valor.tipo === "LIMITE" && valor.limite === "ILIMITADO"
                      ? textoDelValor(valor)
                      : undefined
                  }
                />
              )}
              <span className={estilos["nota"]}>{nota}</span>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
