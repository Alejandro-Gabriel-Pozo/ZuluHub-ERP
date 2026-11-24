"use client";

import { useActionState, useEffect } from "react";
import { BotonDeEnvio } from "../../../patrones/BotonDeEnvio.cliente";
import { ProveedorDeEnvioDeFormulario } from "../../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import { Pila } from "../../../primitivas/Pila";
import {
  FICHA_DE_PROVEEDOR_INICIAL,
  type ResultadoDeFichaDeProveedor,
} from "./resultado-de-proveedor";

export type PropsDeBotonDeResolverPedido = Readonly<{
  /** `resolverPedidoAccion` con el pedido y la decisión ya ligados (`.bind`): no viajan en el formulario. */
  accion: (
    previo: ResultadoDeFichaDeProveedor,
    datos: FormData,
  ) => Promise<ResultadoDeFichaDeProveedor>;
  /** «Aprobar» o «Rechazar», ya resuelto. */
  texto: string;
  variante?: "primaria" | "secundaria";
  rutaDeLaFicha: string;
}>;

/**
 * «Aprobar» o «Rechazar» un pedido pendiente de la ficha (maqueta `compra.html`, `pedidosHtml`): un formulario de un solo botón. No se vuelve a tocar mientras envía; si dos personas resuelven el
 * mismo pedido a la vez, el servidor deja una y a la otra le responde el genérico (aprobar dos veces no escribe dos veces). Si salió bien, vuelve a cargar la ficha (que ya no trae el pedido); si no,
 * el error ya traducido queda debajo del botón.
 */
export function BotonDeResolverPedido({
  accion,
  texto,
  variante,
  rutaDeLaFicha,
}: PropsDeBotonDeResolverPedido) {
  const [resultado, enviar, enviando] = useActionState(accion, FICHA_DE_PROVEEDOR_INICIAL);
  const hecho = resultado.estado === "HECHO";
  useEffect(() => {
    if (hecho) window.location.assign(rutaDeLaFicha);
  }, [hecho, rutaDeLaFicha]);
  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <BotonDeEnvio {...(variante === undefined ? {} : { variante })}>{texto}</BotonDeEnvio>
          {resultado.estado === "ERROR" ? <ErrorDeRespuesta error={resultado.error} /> : null}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
