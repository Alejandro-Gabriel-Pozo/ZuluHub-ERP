"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { AreaDeTexto } from "../../../componentes/AreaDeTexto";
import { Boton } from "../../../componentes/Boton.cliente";
import { ProveedorDeEnvioDeFormulario } from "../../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../../patrones/Superposicion";
import { Pila } from "../../../primitivas/Pila";
import { ANULAR_PAGO_INICIAL, type ResultadoDeAnularPago } from "./resultado-de-pago";

export type PropsDeHojaDeAnularPago = Readonly<{
  /** `anularElPagoAccion` con el pago y la compra ya ligados (`.bind`): el id no viaja en el formulario. */
  accion: (previo: ResultadoDeAnularPago, datos: FormData) => Promise<ResultadoDeAnularPago>;
  textos: Readonly<{ anular: string; motivo: string; cancelar: string; cerrar: string }>;
}>;

/**
 * «Anular» el pago de una factura (maqueta `compra-pago.html`, estado «Anular el pago»): el botón de la tarjeta del pago abre una hoja que pide el motivo, con «Cancelar» y «Anular». «Anular» queda apagado hasta
 * escribir el motivo y no se vuelve a tocar mientras envía. Repetir la anulación es seguro en el servidor (un pago ya anulado se rechaza sin escribir ni devolver el efectivo otra vez). Si salió bien recarga la ficha,
 * que ya muestra «Anulado»; si no, el error ya traducido (el genérico) queda en la hoja y la ficha de atrás se vuelve a leer (otra persona pudo anularlo antes, o la caja ya no está abierta). Mostrar no es autorizar.
 */
export function HojaDeAnularPago({ accion, textos }: PropsDeHojaDeAnularPago) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [resultado, enviar, enviando] = useActionState(accion, ANULAR_PAGO_INICIAL);
  const ruta = resultado.estado === "HECHO" ? resultado.ruta : null;
  const huboError = resultado.estado === "ERROR";
  useEffect(() => {
    if (ruta !== null) window.location.assign(ruta);
  }, [ruta]);
  useEffect(() => {
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
        <form action={enviar}>
          <ProveedorDeEnvioDeFormulario value={enviando}>
            <Pila separacion={3}>
              <AreaDeTexto
                dato="motivo-de-anulacion-de-compra"
                etiqueta={textos.motivo}
                nombre="motivo"
                valor={motivo}
                alCambiar={setMotivo}
              />
              {resultado.estado === "ERROR" ? <ErrorDeRespuesta error={resultado.error} /> : null}
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
