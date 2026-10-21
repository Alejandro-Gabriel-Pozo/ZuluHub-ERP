"use client";

import { useLayoutEffect, useRef } from "react";
import { Icono } from "../../web/ui/iconos/Icono";
import { Texto } from "../../web/ui/primitivas/Texto";
import type { CatalogoDeContraste } from "../logica/contraste-de-submarca";
import { esColorHex, type AspectoDeSubmarca, type ColoresDeSubmarca } from "../logica/submarca";
import estilos from "./vista-previa-de-ingreso.module.css";

export type PropsDeVistaPreviaDeIngreso = Readonly<{
  nombre: string;
  colores: ColoresDeSubmarca;
  aspecto: AspectoDeSubmarca;
  /** De acá salen los colores de fondo y de tarjetas de cada superficie. */
  catalogo: CatalogoDeContraste;
}>;

const NOMBRE_DE_MUESTRA = "Nombre de la submarca";

/**
 * Cómo se vería el ingreso de la submarca con lo que está escrito ahora. Los colores se pintan por CSSOM
 * (`style.setProperty` sobre variables locales): la política de contenido no admite atributos `style` en el HTML.
 * Un color vacío o a medio escribir se quita y vale el color neutro de la interfaz.
 */
export function VistaPreviaDeIngreso({
  nombre,
  colores,
  aspecto,
  catalogo,
}: PropsDeVistaPreviaDeIngreso) {
  const raiz = useRef<HTMLDivElement>(null);
  const fondos = catalogo.superficies.find((s) => s.valor === aspecto.superficie);
  const fondo = fondos?.fondo;
  const superficie = fondos?.superficie;

  useLayoutEffect(() => {
    const el = raiz.current;
    if (el === null) return;
    const poner = (variable: string, valor: string | undefined) => {
      if (valor !== undefined && esColorHex(valor)) el.style.setProperty(variable, valor);
      else el.style.removeProperty(variable);
    };
    poner("--vp-primary", colores.primary);
    poner("--vp-on-primary", colores.onPrimary);
    poner("--vp-accent", colores.accent);
    poner("--vp-fondo", fondo);
    poner("--vp-superficie", superficie);
  }, [colores.primary, colores.onPrimary, colores.accent, fondo, superficie]);

  const titulo = nombre.trim() === "" ? NOMBRE_DE_MUESTRA : nombre.trim();
  const conPanel = aspecto.ingreso !== "CENTRADO";

  return (
    <div className={estilos["envoltura"]}>
      <div
        ref={raiz}
        className={estilos["vista"]}
        role="img"
        aria-label="Vista previa del ingreso"
        data-estilo={aspecto.estilo}
        data-esquinas={aspecto.esquinas}
        data-titulos={aspecto.titulos}
        data-ingreso={aspecto.ingreso}
      >
        {conPanel ? (
          <div className={estilos["panel"]}>
            {aspecto.ingreso === "CON_IMAGEN" ? (
              <div className={estilos["imagen"]}>
                <Icono clave="empresa" tamano="grande" decorativo />
                <span>Imagen de la submarca</span>
              </div>
            ) : (
              <span className={estilos["panelNombre"]}>{titulo}</span>
            )}
          </div>
        ) : null}
        <div className={estilos["tarjeta"]}>
          <span className={estilos["nombre"]}>{titulo}</span>
          <span className={estilos["acento"]} />
          <span className={estilos["etiqueta"]}>Correo</span>
          <span className={estilos["campo"]}>nombre@empresa.com</span>
          <span className={estilos["boton"]}>Ingresar con Google</span>
        </div>
      </div>
      <Texto variante="chico">
        La vista previa aproxima el estilo; los colores, la superficie, las esquinas y los títulos
        se ven como quedarán.
      </Texto>
    </div>
  );
}
