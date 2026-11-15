"use client";

import { useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Campo } from "../../componentes/Campo";
import { Superposicion } from "../../patrones/Superposicion";
import {
  limitarElTexto,
  puedeAnular,
  tituloDeLaAnulacion,
  type LineaDeMovimiento,
} from "./modelo-de-la-caja";
import { armarElPedidoDeAnulacion } from "./pedidos-de-caja";
import { CuerpoDeFormularioDeCaja } from "./CuerpoDeFormularioDeCaja";
import { useEnvioDeCaja } from "./useEnvioDeCaja";

export type PropsDeFormularioDeAnulacion = Readonly<{
  abierta: boolean;
  movimiento: LineaDeMovimiento;
  /** La acción del servidor `anularMovimientoDeCajaAccion`: recibe el pedido con la clave del intento. */
  anular: (pedido: unknown) => Promise<Respuesta<unknown>>;
  largoMaximoDelMotivo: number;
  alTerminar: () => void;
  alCerrar: () => void;
}>;

/**
 * «Anular» un movimiento (maqueta `caja.html`, `vModal`): un cuadro con el motivo, «Cancelar» y «Anular»; el foco inicial va al título (nunca al botón que anula), Escape cierra y Tab queda
 * adentro (`Superposicion`, propósito `confirmar`). Se anula con un motivo y queda el registro nuevo; nada se borra. El motivo de la maqueta es de varias líneas; acá, una (no hay componente
 * multilínea registrado). Idempotente por intento (ver `useEnvioDeCaja`); mientras envía no se cierra.
 */
export function FormularioDeAnulacion({
  abierta,
  movimiento,
  anular,
  largoMaximoDelMotivo,
  alTerminar,
  alCerrar,
}: PropsDeFormularioDeAnulacion) {
  const [motivo, setMotivo] = useState("");
  const { envio, enviarCon, rechazo, referenciaIncierta, ocupado } = useEnvioDeCaja<string>(
    (motivoDelPedido, clave) =>
      anular(armarElPedidoDeAnulacion(clave, movimiento.id, motivoDelPedido)),
    alTerminar,
  );
  return (
    <Superposicion
      abierta={abierta}
      titulo={tituloDeLaAnulacion(movimiento)}
      proposito="confirmar"
      alCerrar={alCerrar}
      cerrable={!ocupado}
      etiquetaDeCerrar={texto({}, "vidriera.producto.cerrar")}
    >
      <CuerpoDeFormularioDeCaja
        alEnviar={() => {
          enviarCon(motivo);
        }}
        textoDeEnviar={texto({}, "caja.accion.anular")}
        puedeEnviar={puedeAnular(motivo) && !envio.bloqueado}
        textoDeCancelar={texto({}, "caja.accion.cancelar")}
        alCancelar={alCerrar}
        ocupado={ocupado}
        enCurso={envio.enCurso}
        incierto={envio.estado.tipo === "incierto"}
        referenciaIncierta={referenciaIncierta}
        rechazo={rechazo}
        motivoQueNoPuede={envio.motivoQueNoPuede}
      >
        <Campo
          dato="motivo-de-movimiento-de-caja"
          etiqueta={texto({}, "caja.campo.motivo")}
          valor={motivo}
          alCambiar={(v) => {
            setMotivo(limitarElTexto(v, largoMaximoDelMotivo));
          }}
          autoComplete="off"
          deshabilitado={ocupado}
        />
      </CuerpoDeFormularioDeCaja>
    </Superposicion>
  );
}
