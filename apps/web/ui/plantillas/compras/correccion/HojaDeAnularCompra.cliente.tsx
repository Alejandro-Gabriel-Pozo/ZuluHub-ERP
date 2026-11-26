"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { AreaDeTexto } from "../../../componentes/AreaDeTexto";
import { Boton } from "../../../componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import { ProveedorDeEnvioDeFormulario } from "../../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../../patrones/Superposicion";
import { Pila } from "../../../primitivas/Pila";
import { ANULAR_INICIAL, type ResultadoDeAnular } from "./resultado-de-correccion";
import { sinReiniciar } from "../../../patrones/sin-reinicio";

export type PropsDeHojaDeAnularCompra = Readonly<{
  /** `anularCompraAccion` con la compra ya ligada (`.bind`): el id no viaja en el formulario. */
  accion: (previo: ResultadoDeAnular, datos: FormData) => Promise<ResultadoDeAnular>;
  /** Adónde lleva «Corregir» junto al aviso de una compra ya consumida; `null` si no hay línea que corregir. */
  corregirLaPrimera: string | null;
  textos: Readonly<{
    anular: string;
    motivo: string;
    cancelar: string;
    cerrar: string;
    corregir: string;
  }>;
}>;

/**
 * «Anular» la compra (maqueta `compra-corregir-anular.html`, `vHoja`): el botón al pie de la ficha abre una hoja que pide el motivo, con «Cancelar» y «Anular». «Anular» queda apagado hasta escribir
 * el motivo y no se vuelve a tocar mientras envía. Repetir la anulación es seguro en el servidor (una compra ya anulada la rechaza sin escribir). Si salió bien recarga la ficha, que ya se ve «Anulada»; si no,
 * el error ya traducido (el genérico) queda en la hoja y la ficha de atrás se vuelve a leer (otra persona pudo anularla antes); si la compra ya se consumió, junto al aviso va «Corregir».
 * Mostrar no es autorizar: el servidor decide si se puede.
 */
export function HojaDeAnularCompra({
  accion,
  corregirLaPrimera,
  textos,
}: PropsDeHojaDeAnularCompra) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [resultado, enviar, enviando] = useActionState(accion, ANULAR_INICIAL);
  const ruta = resultado.estado === "HECHO" ? resultado.ruta : null;
  const huboError = resultado.estado === "ERROR";
  useEffect(() => {
    if (ruta !== null) window.location.assign(ruta);
  }, [ruta]);
  useEffect(() => {
    // Un rechazo puede ser porque otra persona ya la anuló: la ficha de atrás vuelve a leerse.
    if (huboError) router.refresh();
  }, [huboError, resultado, router]);
  return (
    <>
      <Boton variante="peligro" alTocar={() => setAbierta(true)}>
        {textos.anular}
      </Boton>
      <Superposicion
        abierta={abierta}
        proposito="editar"
        titulo={textos.anular}
        alCerrar={() => setAbierta(false)}
        cerrable={!enviando}
        etiquetaDeCerrar={textos.cerrar}
      >
        <form action={enviar} onReset={sinReiniciar}>
          <ProveedorDeEnvioDeFormulario value={enviando}>
            <Pila separacion={3}>
              <AreaDeTexto
                dato="motivo-de-anulacion-de-compra"
                etiqueta={textos.motivo}
                nombre="motivo"
                valor={motivo}
                alCambiar={setMotivo}
              />
              {resultado.estado === "ERROR" ? (
                <ErrorDeRespuesta
                  error={resultado.error}
                  accion={
                    resultado.consumida && corregirLaPrimera !== null ? (
                      <EnlaceDeAccion href={corregirLaPrimera} variante="secundaria">
                        {textos.corregir}
                      </EnlaceDeAccion>
                    ) : undefined
                  }
                />
              ) : null}
              <Boton variante="secundaria" alTocar={() => setAbierta(false)}>
                {textos.cancelar}
              </Boton>
              <Boton
                tipo="submit"
                variante="peligro"
                enviando={enviando || ruta !== null}
                deshabilitado={motivo.trim() === ""}
              >
                {textos.anular}
              </Boton>
            </Pila>
          </ProveedorDeEnvioDeFormulario>
        </form>
      </Superposicion>
    </>
  );
}
