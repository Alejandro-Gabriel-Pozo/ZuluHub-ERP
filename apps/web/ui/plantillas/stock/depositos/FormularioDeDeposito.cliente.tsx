"use client";

import { useState } from "react";
import { Campo } from "../../../componentes/Campo";
import { CampoDeCasilla } from "../../../componentes/CampoDeCasilla";
import { Selector } from "../../../componentes/Selector";
import type { AccionDeFormulario } from "../../../patrones/FormularioDeAccion.cliente";
import { FormularioDeConfiguracion } from "../../caja/FormularioDeConfiguracion.cliente";
import { USO_DE_VENTA } from "./modelo-de-depositos";

export type PropsDeFormularioDeDeposito = Readonly<{
  /** La acción de servidor con el identificador del alta ya ligado (`bind`): lo genera la página al abrir el formulario, así repetir el envío no duplica. */
  accion: AccionDeFormulario;
  textos: Readonly<{ nombre: string; uso: string; deVenta: string; guardar: string }>;
  /** Los usos que se ofrecen, ya con su texto. El primero es el que viene elegido. */
  opcionesDeUso: readonly Readonly<{ valor: string; etiqueta: string }>[];
  puedeGuardar: boolean;
}>;

/**
 * Alta de un depósito (maqueta `stock.html`, 09/11/2026): su nombre y su uso. «De venta» solo se ofrece con el uso Normal (decisión del 15/11/2026, `decisiones-del-dueno-2026-11.md`,
 * «Resueltas por el orquestador… Stock»). La sucursal es la elegida en el dispositivo y la fija el servidor, no el formulario. Un nombre repetido o un segundo «de venta» lo rechaza
 * el servidor al guardar: la pantalla no replica esas reglas.
 */
export function FormularioDeDeposito({
  accion,
  textos,
  opcionesDeUso,
  puedeGuardar,
}: PropsDeFormularioDeDeposito) {
  const [nombre, setNombre] = useState("");
  const [uso, setUso] = useState(opcionesDeUso[0]?.valor ?? "");
  const [deVenta, setDeVenta] = useState(false);
  return (
    <FormularioDeConfiguracion
      accion={accion}
      textoGuardar={textos.guardar}
      puedeGuardar={puedeGuardar && nombre.trim() !== "" && uso !== ""}
    >
      <Campo
        dato="nombre-de-deposito"
        etiqueta={textos.nombre}
        nombre="nombre"
        valor={nombre}
        alCambiar={setNombre}
        autoComplete="off"
      />
      <Selector
        dato="uso-de-deposito"
        etiqueta={textos.uso}
        nombre="uso"
        valor={uso}
        alCambiar={(nuevo) => {
          setUso(nuevo);
          if (nuevo !== USO_DE_VENTA) setDeVenta(false);
        }}
        opciones={opcionesDeUso}
      />
      {uso === USO_DE_VENTA ? (
        <CampoDeCasilla
          dato="deposito-de-venta"
          etiqueta={textos.deVenta}
          nombre="deVenta"
          marcada={deVenta}
          alCambiar={setDeVenta}
        />
      ) : null}
    </FormularioDeConfiguracion>
  );
}
