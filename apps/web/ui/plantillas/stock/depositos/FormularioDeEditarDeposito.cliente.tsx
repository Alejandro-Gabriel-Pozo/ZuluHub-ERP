"use client";

import { useState } from "react";
import { Boton } from "../../../componentes/Boton.cliente";
import { Campo } from "../../../componentes/Campo";
import { Casilla } from "../../../componentes/Casilla";
import { BotonDeEnvio } from "../../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../../patrones/FormularioDeAccion.cliente";
import estilos from "./FormularioDeDeposito.module.css";

export type PropsDeFormularioDeEditarDeposito = Readonly<{
  /** La acción de servidor con el depósito y la versión que se vio ya ligados (`bind`): si otra persona lo cambió antes, el servidor rechaza. */
  accion: AccionDeFormulario;
  textos: Readonly<{
    nombre: string;
    uso: string;
    deVenta: string;
    guardar: string;
    cancelar: string;
  }>;
  /** Lo que hoy tiene el depósito. El uso se ve y no se cambia. */
  actual: Readonly<{ nombre: string; uso: string; deVenta: boolean; admiteDeVenta: boolean }>;
  /** Adónde vuelve «Cancelar»: la lista. Es un enlace: cancelar no manda nada. */
  hrefDeCancelar: string;
  puedeGuardar: boolean;
}>;

/**
 * Editar un depósito (maqueta `stock-depositos-gestion.html`, 25/11/2026): su nombre y si es «de venta»; el uso se muestra sin poder cambiarse (no cambia después del alta). «De venta» solo se
 * ofrece si el uso lo admite (Normal). Un nombre repetido, un segundo «de venta» o una versión vieja los rechaza el servidor al guardar: la pantalla no replica esas reglas. Sin permiso o con el
 * nombre vacío, «Guardar» sale apagado.
 */
export function FormularioDeEditarDeposito({
  accion,
  textos,
  actual,
  hrefDeCancelar,
  puedeGuardar,
}: PropsDeFormularioDeEditarDeposito) {
  const [nombre, setNombre] = useState(actual.nombre);
  const [deVenta, setDeVenta] = useState(actual.deVenta);
  return (
    <FormularioDeAccion accion={accion}>
      <Campo
        dato="nombre-de-deposito"
        etiqueta={textos.nombre}
        nombre="nombre"
        valor={nombre}
        alCambiar={setNombre}
        autoComplete="off"
      />
      <div className={estilos["actual"]}>
        <span>{textos.uso}</span>
        <span>{actual.uso}</span>
      </div>
      {actual.admiteDeVenta ? (
        <Casilla
          dato="deposito-de-venta"
          etiqueta={textos.deVenta}
          nombre="deVenta"
          marcada={deVenta}
          alCambiar={setDeVenta}
        />
      ) : null}
      <div className={estilos["acciones"]}>
        <a className={estilos["secundario"]} href={hrefDeCancelar}>
          {textos.cancelar}
        </a>
        {puedeGuardar && nombre.trim() !== "" ? (
          <BotonDeEnvio>{textos.guardar}</BotonDeEnvio>
        ) : (
          <Boton deshabilitado>{textos.guardar}</Boton>
        )}
      </div>
    </FormularioDeAccion>
  );
}
