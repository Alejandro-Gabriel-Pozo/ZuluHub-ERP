"use client";

import { Campo } from "../../web/ui/componentes/Campo";
import { esColorHex, normalizarColor } from "../logica/submarca";
import propios from "./submarcas.module.css";

/** Lo que muestra el selector nativo de color cuando el texto está vacío o a medio escribir. */
const COLOR_DE_MUESTRA = "#000000";

type PropsDeCampoDeColor = Readonly<{
  etiqueta: string;
  valor: string;
  error: string | undefined;
  deshabilitado: boolean;
  alCambiar: (valor: string) => void;
}>;

/** Un color: el selector nativo y el texto `#rrggbb` van sincronizados. El texto se normaliza al salir del campo. */
export function CampoDeColor({
  etiqueta,
  valor,
  error,
  deshabilitado,
  alCambiar,
}: PropsDeCampoDeColor) {
  const normalizado = normalizarColor(valor);
  const paraElSelector = esColorHex(normalizado) ? normalizado : COLOR_DE_MUESTRA;
  return (
    <div className={propios["color"]}>
      <div
        className={propios["colorTexto"]}
        onBlur={() => {
          if (normalizado !== valor) alCambiar(normalizado);
        }}
      >
        <Campo
          etiqueta={etiqueta}
          nombre={`color-${etiqueta}`}
          autoComplete="off"
          autoCapitalize="off"
          ayuda="Por ejemplo #1f4e79."
          valor={valor}
          alCambiar={alCambiar}
          error={error}
          deshabilitado={deshabilitado}
        />
      </div>
      <input
        type="color"
        className={propios["muestra"]}
        aria-label={`Elegir el color: ${etiqueta}`}
        value={paraElSelector}
        disabled={deshabilitado}
        onChange={(evento) => {
          alCambiar(evento.target.value.toLowerCase());
        }}
      />
    </div>
  );
}
