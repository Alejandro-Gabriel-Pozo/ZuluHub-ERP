"use client";

import { useId } from "react";
import { SoloLector } from "../../primitivas/SoloLector";
import { aplicarEstilos } from "../../primitivas/aplicar-estilos";
import estilos from "./PlanoDeMesas.module.css";
import type { MesaDelPlano, PlanoArmado } from "./modelo-del-plano";

export type PropsDePlanoDeMesas = Readonly<{ plano: PlanoArmado }>;

const porcentaje = (n: number): string => `${String(n)}%`;

function Mesa({ mesa }: Readonly<{ mesa: MesaDelPlano }>) {
  const contenido = (
    <>
      <SoloLector>{mesa.nombre}</SoloLector>
      {mesa.forma === "REDONDA" ? (
        <svg
          className={estilos["elipse"]}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <ellipse cx="50" cy="50" rx="50" ry="50" />
        </svg>
      ) : null}
      <span className={estilos["numero"]} aria-hidden="true">
        {mesa.numero}
      </span>
    </>
  );
  return (
    <li
      className={estilos["mesa"]}
      data-forma={mesa.forma}
      data-borrador={mesa.borrador ? "si" : "no"}
      ref={(elemento) => {
        aplicarEstilos(elemento, {
          "--izquierda": porcentaje(mesa.izquierda),
          "--arriba": porcentaje(mesa.arriba),
          "--ancho": porcentaje(mesa.ancho),
          "--alto": porcentaje(mesa.alto),
        });
      }}
    >
      {mesa.href === null ? (
        <span className={estilos["contenido"]}>{contenido}</span>
      ) : (
        <a className={estilos["contenido"]} href={mesa.href}>
          {contenido}
        </a>
      )}
    </li>
  );
}

/**
 * El mapa chico del salón (S-1b; maqueta `mesas.html`, aprobada el 09/11/2026): una cuadrícula de 14 × 9 con cada mesa activa dibujada en su casilla, con su forma y su tamaño. Solo dibuja lo que
 * llega armado (`modelo-del-plano.ts`): no arrastra, no valida y no dice si algo «entra» o «se pisa» (lo decide el servidor al guardar). Accesible: es una lista rotulada «Plano»; cada
 * mesa dice su nombre («Mesa 7») al lector de pantalla y su número a la vista, y el borrador del formulario se distingue por el trazo punteado y no solo por el color. Si la mesa tiene
 * `href` es un enlace (teclado y toque); si no, texto. Las medidas se aplican por CSSOM (`aplicarEstilos`), nunca con `style=`.
 */
export function PlanoDeMesas({ plano }: PropsDePlanoDeMesas) {
  const idDeLaEtiqueta = useId();
  return (
    <div className={estilos["raiz"]}>
      <span id={idDeLaEtiqueta} className={estilos["etiqueta"]}>
        {plano.etiqueta}
      </span>
      <ul
        className={estilos["plano"]}
        aria-labelledby={idDeLaEtiqueta}
        ref={(elemento) => {
          aplicarEstilos(elemento, {
            "--columnas": String(plano.columnas),
            "--filas": String(plano.filas),
          });
        }}
      >
        {plano.mesas.map((mesa) => (
          <Mesa key={mesa.clave} mesa={mesa} />
        ))}
      </ul>
    </div>
  );
}
