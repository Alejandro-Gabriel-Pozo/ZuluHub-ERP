"use client";

import { useState } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { Selector } from "../../componentes/Selector";
import { ErrorDelDetalle } from "../../patrones/ErrorDelDetalle";
import { Superposicion } from "../../patrones/Superposicion";
import { BotonDeAccionDelCierre, type AccionDelCierre } from "./BotonDeAccionDelCierre.cliente";
import type { CobroVisto, MedioVisto } from "./modelo-del-cierre";
import estilos from "./PantallaDelCierre.module.css";

type Props = Readonly<{
  cobro: CobroVisto;
  medios: readonly MedioVisto[];
  corregir: AccionDelCierre;
  /** Se corrigió (o ya estaba corregido con esta clave): la pantalla cierra el diálogo y vuelve a leer el día. */
  alCorregir: () => void;
  alCancelar: () => void;
}>;

/** Los medios que se ofrecen: todos los activos menos el vigente del cobro, salvo que tenga más de una cuenta (se puede pasar de una cuenta a otra del mismo medio). */
function mediosOfrecidos(cobro: CobroVisto, medios: readonly MedioVisto[]): readonly MedioVisto[] {
  return medios.filter((m) => m.medioDePagoId !== cobro.medioDePagoId || m.cuentas.length > 1);
}

/**
 * «Corregir medio» de UN cobro (maqueta aceptada, DDD:183): el resumen del cobro, el «Medio correcto», la «Cuenta de cobro» (si el medio admite cuentas, con la opción «Sin cuenta») y el «Motivo»,
 * obligatorio. «Guardar» queda apagado sin motivo. El medio y la cuenta son una elección cerrada que ofrece el servidor (los activos y compatibles); qué par es válido lo decide el caso de uso
 * al guardar, y el cobro original no cambia. Idempotente: la clave del intento la pone `BotonDeAccionDelCierre`. Si el servidor rechaza, el aviso se ve acá y el diálogo sigue abierto.
 */
export function ModalDeCorregirMedio({ cobro, medios, corregir, alCorregir, alCancelar }: Props) {
  const opciones = mediosOfrecidos(cobro, medios);
  const [medioId, setMedioId] = useState(opciones[0]?.medioDePagoId ?? "");
  const [cuentaId, setCuentaId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<ErrorPublico | null>(null);
  const elegido = opciones.find((m) => m.medioDePagoId === medioId);
  const cuentas = elegido?.cuentas ?? [];

  const responder = (respuesta: Respuesta<unknown>) => {
    if (respuesta.ok) alCorregir();
    else setError(respuesta.error);
  };

  return (
    <Superposicion
      abierta
      proposito="editar"
      titulo={texto({}, "cierre.corregir_medio")}
      alCerrar={alCancelar}
      cerrable
      etiquetaDeCerrar={texto({}, "vidriera.producto.cerrar")}
    >
      <div className={estilos["formulario"]}>
        <p>
          {cobro.importe} · {cobro.medio}
        </p>
        <Selector
          dato="medio-de-cobro"
          etiqueta={texto({}, "cierre.medio_correcto")}
          valor={medioId}
          alCambiar={(valor) => {
            setMedioId(valor);
            setCuentaId("");
          }}
          opciones={opciones.map((m) => ({ valor: m.medioDePagoId, etiqueta: m.titulo }))}
        />
        {cuentas.length === 0 ? null : (
          <Selector
            dato="cuenta-de-cobro"
            etiqueta={texto({}, "ventas.cobro.cuenta_de_cobro")}
            valor={cuentaId}
            alCambiar={setCuentaId}
            textoDeElegir={texto({}, "caja.sin_cuenta")}
            opciones={cuentas.map((c) => ({ valor: c.id, etiqueta: c.nombre }))}
          />
        )}
        <Campo
          dato="motivo-de-correccion-de-medio"
          etiqueta={texto({}, "ventas.ticket.motivo")}
          valor={motivo}
          alCambiar={setMotivo}
        />
        {error === null ? null : <ErrorDelDetalle error={error} />}
        <div className={estilos["botones"]}>
          <Boton variante="secundaria" ancho="completo" alTocar={alCancelar}>
            {texto({}, "catalogo.accion.cancelar")}
          </Boton>
          <BotonDeAccionDelCierre
            deshabilitado={motivo.trim() === "" || elegido === undefined}
            accion={corregir}
            conClave
            armarPedido={() => ({
              cobroId: cobro.cobroId,
              medioDestinoId: medioId,
              cuentaDestinoId: cuentaId === "" ? null : cuentaId,
              motivo,
            })}
            alResponder={responder}
          >
            {texto({}, "caja.accion.guardar")}
          </BotonDeAccionDelCierre>
        </div>
      </div>
    </Superposicion>
  );
}
