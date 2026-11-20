"use client";

import { useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { CampoImporte } from "../../componentes/CampoImporte";
import { puedeAbrir } from "./modelo-de-la-caja";
import { armarElPedidoDeApertura } from "./pedidos-de-caja";
import { CuerpoDeFormularioDeCaja } from "./CuerpoDeFormularioDeCaja";
import { useEnvioDeCaja } from "./useEnvioDeCaja";

export type PropsDeFormularioDeApertura = Readonly<{
  cajaId: string;
  /** La acción del servidor `abrirCajaAccion`: recibe el pedido con la clave del intento. */
  abrir: (pedido: unknown) => Promise<Respuesta<unknown>>;
  /** Si el servidor deja abrir hoy (solo una ayuda: el guard decide al enviar). */
  puedeAbrir: boolean;
  alTerminar: () => void;
  alCancelar: () => void;
}>;

/**
 * «Abrir caja» (maqueta `caja.html`, `vAbrir`): se declara el fondo inicial; entra como un movimiento «fondo inicial» que no se anula. El envío es idempotente por intento (ver `useEnvioDeCaja`):
 * abrir dos veces seguidas es una sola sesión. Sin la sugerencia del último cierre (no se muestra). Si el día está en cierre o cerrado, el servidor rechaza al intentarlo y la pantalla dice su motivo.
 */
export function FormularioDeApertura({
  cajaId,
  abrir,
  puedeAbrir: ofrecida,
  alTerminar,
  alCancelar,
}: PropsDeFormularioDeApertura) {
  const [fondo, setFondo] = useState("");
  const { envio, enviarCon, rechazo, referenciaIncierta, ocupado } = useEnvioDeCaja<string>(
    (fondoInicial, clave) => abrir(armarElPedidoDeApertura(clave, cajaId, fondoInicial)),
    alTerminar,
  );
  const listo = ofrecida && puedeAbrir(fondo) && !envio.bloqueado;
  return (
    <CuerpoDeFormularioDeCaja
      alEnviar={() => {
        enviarCon(fondo);
      }}
      textoDeEnviar={texto({}, "caja.sesion.abrir")}
      puedeEnviar={listo}
      textoDeCancelar={texto({}, "caja.accion.cancelar")}
      alCancelar={alCancelar}
      ocupado={ocupado}
      enCurso={envio.enCurso}
      incierto={envio.estado.tipo === "incierto"}
      referenciaIncierta={referenciaIncierta}
      rechazo={rechazo}
      motivoQueNoPuede={envio.motivoQueNoPuede}
    >
      <CampoImporte
        dato="importe-de-fondo-inicial"
        etiqueta={texto({}, "caja.campo.fondo_inicial")}
        valor={fondo}
        alCambiar={setFondo}
        deshabilitado={ocupado}
      />
    </CuerpoDeFormularioDeCaja>
  );
}
