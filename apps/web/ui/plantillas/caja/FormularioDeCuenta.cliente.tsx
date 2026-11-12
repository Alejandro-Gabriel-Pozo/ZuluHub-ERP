"use client";

import { useState } from "react";
import { Campo } from "../../componentes/Campo";
import { Selector } from "../../componentes/Selector";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeConfiguracion } from "./FormularioDeConfiguracion.cliente";
import type { CuentaDeLaLista, OpcionDeLista } from "./modelo-de-cuentas-de-cobro";

export type PropsDeFormularioDeCuenta = Readonly<{
  /** La cuenta que se edita; `null`: es un alta. */
  original: CuentaDeLaLista | null;
  tipos: readonly OpcionDeLista[];
  /** Las sucursales ABIERTAS que la persona puede elegir (el servidor ya filtró): una cuenta es de UNA sucursal, siempre elegida. */
  sucursales: readonly OpcionDeLista[];
  accion: AccionDeFormulario;
  textos: Readonly<{
    nombre: string;
    tipo: string;
    identificador: string;
    sucursal: string;
    guardar: string;
  }>;
  puedeGuardar: boolean;
}>;

/**
 * Alta y edición de una cuenta de cobro (maqueta `medios.html`, 09/11/2026): nombre, tipo (terminal, QR o cuenta bancaria; no se cambia después: en la edición sale apagado),
 * un identificador opcional (número de terminal o alias, nunca claves) y la sucursal, que hay que elegir. La validez la decide el servidor; el error vuelve debajo.
 */
export function FormularioDeCuenta({
  original,
  tipos,
  sucursales,
  accion,
  textos,
  puedeGuardar,
}: PropsDeFormularioDeCuenta) {
  const [nombre, setNombre] = useState(original?.nombre ?? "");
  const [tipo, setTipo] = useState(original?.tipo ?? tipos[0]?.valor ?? "");
  const [identificador, setIdentificador] = useState(original?.identificadorExterno ?? "");
  const [sucursal, setSucursal] = useState(original?.sucursalId ?? sucursales[0]?.valor ?? "");
  return (
    <FormularioDeConfiguracion
      accion={accion}
      textoGuardar={textos.guardar}
      puedeGuardar={puedeGuardar}
    >
      <Campo
        dato="nombre-de-cuenta-de-cobro"
        etiqueta={textos.nombre}
        nombre="nombre"
        valor={nombre}
        alCambiar={setNombre}
        autoComplete="off"
      />
      <Selector
        dato="tipo-de-cuenta-de-cobro"
        etiqueta={textos.tipo}
        nombre="tipo"
        valor={tipo}
        alCambiar={setTipo}
        opciones={tipos}
        deshabilitado={original !== null}
      />
      <Campo
        dato="identificador-de-cuenta-de-cobro"
        etiqueta={textos.identificador}
        nombre="identificadorExterno"
        valor={identificador}
        alCambiar={setIdentificador}
        autoComplete="off"
        autoCapitalize="off"
      />
      <Selector
        dato="sucursal-de-cuenta-de-cobro"
        etiqueta={textos.sucursal}
        nombre="sucursalId"
        valor={sucursal}
        alCambiar={setSucursal}
        opciones={sucursales}
      />
    </FormularioDeConfiguracion>
  );
}
