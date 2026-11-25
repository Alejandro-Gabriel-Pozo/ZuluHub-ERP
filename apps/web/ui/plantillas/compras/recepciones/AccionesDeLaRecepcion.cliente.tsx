"use client";

import { useActionState, useEffect, useState } from "react";
import { AreaDeTexto } from "../../../componentes/AreaDeTexto";
import { Boton } from "../../../componentes/Boton.cliente";
import { Selector } from "../../../componentes/Selector";
import { ProveedorDeEnvioDeFormulario } from "../../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../../patrones/Superposicion";
import { Pila } from "../../../primitivas/Pila";
import { RECEPCION_INICIAL, type ResultadoDeLaRecepcion } from "./resultado-de-recepcion";

type AccionDeLaRecepcion = (
  previo: ResultadoDeLaRecepcion,
  datos: FormData,
) => Promise<ResultadoDeLaRecepcion>;

export type PropsDeAccionesDeLaRecepcion = Readonly<{
  /** Se ofrece «Confirmar recepción» (permiso y estado). Solo ayuda: el servidor decide. */
  puedeConfirmar: boolean;
  /** Se ofrece «Anular recepción» (permiso y estado). Solo ayuda: el servidor decide. */
  puedeAnular: boolean;
  /** `confirmarRecepcionAccion` con la recepción ya ligada (`.bind`): el id no viaja en el formulario. */
  accionDeConfirmar: AccionDeLaRecepcion;
  /** `anularRecepcionAccion` con la recepción ya ligada (`.bind`). */
  accionDeAnular: AccionDeLaRecepcion;
  /** Los depósitos de uso normal y activos de la sucursal, SOLO si hay más de uno (con uno, el servidor lo toma). */
  depositos: readonly Readonly<{ id: string; nombre: string }>[];
  textos: Readonly<{
    confirmar: string;
    anularRecepcion: string;
    anular: string;
    motivo: string;
    cancelar: string;
    cerrar: string;
    deposito: string;
    sinElegir: string;
  }>;
}>;

/**
 * «Confirmar recepción» y «Anular recepción» (maqueta `compra-recibir.html`, estados «Por confirmar»): los dos botones del detalle de una recepción pendiente, para gerente y administrador. «Confirmar recepción» es
 * el momento en que la mercadería pasa a ser stock: si la sucursal tiene más de un depósito normal pide elegir en cuál entra. «Anular recepción» abre una hoja que pide el motivo. Los dos se apagan mientras
 * envían (un segundo toque no manda nada) y repetirlos es seguro en el servidor (confirmar dos veces deja una sola entrada de stock; anular una ya anulada no escribe). Si salió bien recarga el detalle;
 * si el servidor rechaza muestra el error ya traducido (el genérico) y el detalle de atrás se vuelve a leer (otra persona pudo actuar antes). Mostrar no es autorizar: el servidor decide si se puede.
 */
export function AccionesDeLaRecepcion({
  puedeConfirmar,
  puedeAnular,
  accionDeConfirmar,
  accionDeAnular,
  depositos,
  textos,
}: PropsDeAccionesDeLaRecepcion) {
  const [depositoId, setDepositoId] = useState("");
  const [abierta, setAbierta] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [confirmado, confirmar, confirmando] = useActionState(accionDeConfirmar, RECEPCION_INICIAL);
  const [anulado, anular, anulando] = useActionState(accionDeAnular, RECEPCION_INICIAL);
  const hayDepositoAElegir = depositos.length > 1;
  const ruta =
    confirmado.estado === "HECHO"
      ? confirmado.ruta
      : anulado.estado === "HECHO"
        ? anulado.ruta
        : null;
  useEffect(() => {
    if (ruta !== null) window.location.assign(ruta);
  }, [ruta]);
  return (
    <>
      {puedeConfirmar ? (
        <form action={confirmar}>
          <ProveedorDeEnvioDeFormulario value={confirmando}>
            <Pila separacion={3}>
              {hayDepositoAElegir ? (
                <Selector
                  dato="deposito-de-compra"
                  etiqueta={textos.deposito}
                  nombre="depositoId"
                  valor={depositoId}
                  alCambiar={setDepositoId}
                  opciones={depositos.map((d) => ({ valor: d.id, etiqueta: d.nombre }))}
                  textoDeElegir={textos.sinElegir}
                />
              ) : null}
              {confirmado.estado === "ERROR" ? <ErrorDeRespuesta error={confirmado.error} /> : null}
              <Boton
                tipo="submit"
                enviando={confirmando || confirmado.estado === "HECHO"}
                deshabilitado={hayDepositoAElegir && depositoId === ""}
              >
                {textos.confirmar}
              </Boton>
            </Pila>
          </ProveedorDeEnvioDeFormulario>
        </form>
      ) : null}
      {puedeAnular ? (
        <>
          <Boton variante="peligro" alTocar={() => setAbierta(true)}>
            {textos.anularRecepcion}
          </Boton>
          <Superposicion
            abierta={abierta}
            proposito="editar"
            titulo={textos.anularRecepcion}
            alCerrar={() => setAbierta(false)}
            cerrable={!anulando}
            etiquetaDeCerrar={textos.cerrar}
          >
            <form action={anular}>
              <ProveedorDeEnvioDeFormulario value={anulando}>
                <Pila separacion={3}>
                  <AreaDeTexto
                    dato="motivo-de-anulacion-de-compra"
                    etiqueta={textos.motivo}
                    nombre="motivo"
                    valor={motivo}
                    alCambiar={setMotivo}
                  />
                  {anulado.estado === "ERROR" ? <ErrorDeRespuesta error={anulado.error} /> : null}
                  <Boton variante="secundaria" alTocar={() => setAbierta(false)}>
                    {textos.cancelar}
                  </Boton>
                  <Boton
                    tipo="submit"
                    variante="peligro"
                    enviando={anulando || anulado.estado === "HECHO"}
                    deshabilitado={motivo.trim() === ""}
                  >
                    {textos.anular}
                  </Boton>
                </Pila>
              </ProveedorDeEnvioDeFormulario>
            </form>
          </Superposicion>
        </>
      ) : null}
    </>
  );
}
