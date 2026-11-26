"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { AreaDeTexto } from "../../../componentes/AreaDeTexto";
import { Boton } from "../../../componentes/Boton.cliente";
import { Selector } from "../../../componentes/Selector";
import { BotonDeEnvio } from "../../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../../patrones/FormularioDeAccion.cliente";
import { puedeAplicar, type FilaParaRevisar } from "./modelo-de-conteo";
import estilos from "./FormularioDeAplicarConteo.module.css";

export type PropsDeFormularioDeAplicarConteo = Readonly<{
  /** La acción de servidor con el conteo y la huella de lo que se ve ya ligados (`bind`): aplicar dos veces es uno; si cambió lo que el sistema creía, no se aplica. */
  accion: AccionDeFormulario;
  filas: readonly FilaParaRevisar[];
  /** Adónde lleva «Cancelar» (volver a Conteo). */
  hrefDeCancelar: string;
  /** Si la persona puede aplicar (el servidor igual decide). */
  puedeEnviar: boolean;
}>;

/**
 * La revisión del conteo (maqueta `stock-conteo.html`, FP-STK-11): por artículo, lo contado, lo que el sistema creía a esa hora, lo movido desde entonces y la diferencia; si hay diferencia, el motivo de la lista cerrada
 * (y el detalle si es «otra»). Todo lo calculó el servidor: acá no se recalcula nada. «Aplicar» sale apagado hasta que toda diferencia tiene su motivo (ayuda; el servidor decide). Si el servidor rechaza porque cambió lo que
 * se veía (entró un movimiento mientras se revisaba), la pantalla se recarga con lo nuevo y su huella; las elecciones de la persona se conservan.
 */
export function FormularioDeAplicarConteo({
  accion,
  filas,
  hrefDeCancelar,
  puedeEnviar,
}: PropsDeFormularioDeAplicarConteo) {
  const router = useRouter();
  const [respuestas, setRespuestas] = useState<
    Readonly<Record<string, Readonly<{ motivo: string; detalle: string }>>>
  >({});
  const poner = (articuloId: string, cambio: Partial<{ motivo: string; detalle: string }>) =>
    setRespuestas((r) => ({
      ...r,
      [articuloId]: { motivo: "", detalle: "", ...r[articuloId], ...cambio },
    }));

  const conRecarga: AccionDeFormulario = async (previo, datos) => {
    const resultado = await accion(previo, datos);
    // Cuando sale bien, Next redirige y el pedido no devuelve valor; si no, se vuelve a pedir la revisión (puede haber cambiado).
    if (resultado?.error !== null && resultado !== undefined) router.refresh();
    return resultado;
  };

  return (
    <FormularioDeAccion accion={conRecarga}>
      <ul className={estilos["filas"]}>
        {filas.map((fila) => {
          const r = respuestas[fila.articuloId] ?? { motivo: "", detalle: "" };
          const elegido = fila.motivos.find((m) => m.codigo === r.motivo);
          return (
            <li key={fila.articuloId} className={estilos["fila"]}>
              <strong className={estilos["nombre"]}>{fila.nombre}</strong>
              <dl className={estilos["datos"]}>
                <div>
                  <dt>{texto({}, "stock.conteo.contado")}</dt>
                  <dd>{fila.contado}</dd>
                </div>
                {fila.sistema === null ? null : (
                  <div>
                    <dt>{texto({}, "stock.conteo.sistema_a_esa_hora")}</dt>
                    <dd>{fila.sistema}</dd>
                  </div>
                )}
                {fila.movido === null ? null : (
                  <div>
                    <dt>{fila.rotuloDeMovido}</dt>
                    <dd>{fila.movido}</dd>
                  </div>
                )}
                {fila.diferencia === null ? null : (
                  <div>
                    <dt>{texto({}, "stock.conteo.diferencia")}</dt>
                    <dd>{fila.diferencia}</dd>
                  </div>
                )}
              </dl>
              {fila.conDiferencia ? (
                <>
                  <Selector
                    dato="motivo-de-diferencia-de-conteo"
                    etiqueta={texto({}, "stock.accion.motivo")}
                    nombre={`motivo.${fila.articuloId}`}
                    valor={r.motivo}
                    alCambiar={(v) => poner(fila.articuloId, { motivo: v })}
                    textoDeElegir={texto({}, "stock.accion.motivo")}
                    opciones={fila.motivos.map((m) => ({ valor: m.codigo, etiqueta: m.etiqueta }))}
                  />
                  {elegido?.pideDetalle === true ? (
                    <AreaDeTexto
                      dato="detalle-de-movimiento-de-stock"
                      etiqueta={texto({}, "stock.accion.detalle")}
                      nombre={`detalle.${fila.articuloId}`}
                      valor={r.detalle}
                      alCambiar={(v) => poner(fila.articuloId, { detalle: v })}
                    />
                  ) : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className={estilos["acciones"]}>
        <a className={estilos["secundario"]} href={hrefDeCancelar}>
          {texto({}, "catalogo.accion.cancelar")}
        </a>
        {puedeEnviar && puedeAplicar(filas, respuestas) ? (
          <BotonDeEnvio>{texto({}, "stock.conteo.aplicar")}</BotonDeEnvio>
        ) : (
          <Boton deshabilitado>{texto({}, "stock.conteo.aplicar")}</Boton>
        )}
      </div>
    </FormularioDeAccion>
  );
}
