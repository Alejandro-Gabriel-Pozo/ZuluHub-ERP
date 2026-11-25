"use client";

import { useRef, useState } from "react";
import type {
  ErrorPublico,
  Respuesta,
} from "../../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../../componentes/Boton.cliente";
import { Campo } from "../../../componentes/Campo";
import { Selector } from "../../../componentes/Selector";
import { Aviso } from "../../../componentes/Aviso";
import { ErrorDelDetalle } from "../../../patrones/ErrorDelDetalle";
import { Superposicion } from "../../../patrones/Superposicion";
import { Pila } from "../../../primitivas/Pila";
import type { TextosDeNuevaCompra } from "./textos-de-nueva-compra";

/** Lo que vuelve de guardar el proveedor: o quedó guardado (con su id) o hay parecidos y NO se escribió nada (la misma forma que el alta del directorio). */
type ResultadoDeAgregarProveedor = Readonly<
  | { estado: "GUARDADA"; parteId: string }
  | { estado: "DUPLICADOS"; duplicados: readonly Readonly<{ parteId: string; nombre: string }>[] }
>;

export type AgregarProveedor = (
  clave: string,
  naturaleza: string,
  nombre: string,
  guardarIgual: boolean,
) => Promise<Respuesta<ResultadoDeAgregarProveedor>>;

export type PropsDeHojaDeNuevoProveedor = Readonly<{
  abierta: boolean;
  alCerrar: () => void;
  /** Quedó guardado: la compra lo elige y la hoja se cierra. El nombre es el que se escribió. */
  alAgregar: (proveedor: Readonly<{ id: string; nombre: string; tieneCuit: boolean }>) => void;
  accion: AgregarProveedor;
  textos: TextosDeNuevaCompra;
}>;

/**
 * «Agregar proveedor» sin salir de la compra (maqueta `compra.html`, estado `prov-nuevo`): solo el nombre y si es persona o empresa; queda con el rol Proveedor y nada más (DDD 15/11/2026, 8a).
 * Es el MISMO alta del directorio. Si ya hay uno con ese nombre, avisa y NO bloquea (8b): el primer «Agregar» no escribe nada y muestra el aviso; el segundo agrega igual. La clave de creación se
 * genera al abrir la hoja y se reusa en cada toque: un doble toque o un reintento no crea dos proveedores (el servidor devuelve el mismo). No hay modo sin conexión: sin red el botón no sale.
 */
export function HojaDeNuevoProveedor({
  abierta,
  alCerrar,
  alAgregar,
  accion,
  textos,
}: PropsDeHojaDeNuevoProveedor) {
  const [naturaleza, setNaturaleza] = useState("JURIDICA");
  const [nombre, setNombre] = useState("");
  const [hayParecidos, setHayParecidos] = useState(false);
  const [error, setError] = useState<ErrorPublico | null>(null);
  const [enviando, setEnviando] = useState(false);
  // La clave del alta: una por apertura de la hoja; se renueva al cerrarla (otro proveedor, otra clave).
  const clave = useRef<string | null>(null);
  const enVuelo = useRef(false);

  const cerrar = () => {
    clave.current = null;
    setNombre("");
    setHayParecidos(false);
    setError(null);
    alCerrar();
  };

  const agregar = async () => {
    if (enVuelo.current || nombre.trim() === "") return;
    enVuelo.current = true;
    setEnviando(true);
    setError(null);
    clave.current ??= crypto.randomUUID();
    try {
      const r = await accion(clave.current, naturaleza, nombre.trim(), hayParecidos);
      if (!r.ok) {
        setError(r.error);
      } else if (r.dato.estado === "DUPLICADOS") {
        setHayParecidos(true);
      } else {
        const agregado = { id: r.dato.parteId, nombre: nombre.trim() };
        clave.current = null;
        setNombre("");
        setHayParecidos(false);
        // Un proveedor recién agregado no tiene CUIT: la primera factura lo pide.
        alAgregar({ ...agregado, tieneCuit: false });
      }
    } catch {
      // Sin respuesta: no se sabe si quedó guardado. La clave se conserva: otro toque repite el MISMO alta y el servidor devuelve el mismo proveedor.
    } finally {
      enVuelo.current = false;
      setEnviando(false);
    }
  };

  const esPersona = naturaleza === "HUMANA";
  return (
    <Superposicion
      abierta={abierta}
      titulo={textos.agregarProveedor}
      proposito="editar"
      alCerrar={cerrar}
      cerrable={!enviando}
      etiquetaDeCerrar={textos.cerrar}
    >
      <Pila separacion={3}>
        <Selector
          dato="naturaleza-de-parte"
          etiqueta={`${textos.persona} / ${textos.empresa}`}
          valor={naturaleza}
          alCambiar={(nueva) => {
            setNaturaleza(nueva);
            setHayParecidos(false);
          }}
          opciones={[
            { valor: "HUMANA", etiqueta: textos.persona },
            { valor: "JURIDICA", etiqueta: textos.empresa },
          ]}
        />
        <Campo
          dato="nombre-de-parte"
          etiqueta={esPersona ? textos.nombre : textos.razonSocial}
          valor={nombre}
          alCambiar={(nuevo) => {
            setNombre(nuevo);
            setHayParecidos(false);
          }}
          autoComplete="off"
        />
        {hayParecidos ? <Aviso tono="aviso">{textos.yaExisteUnProveedor}</Aviso> : null}
        {error === null ? null : <ErrorDelDetalle error={error} />}
        <Boton
          ancho="completo"
          alTocar={() => {
            void agregar();
          }}
          enviando={enviando}
          textoEnviando={textos.enviando}
          deshabilitado={nombre.trim() === ""}
        >
          {textos.agregar}
        </Boton>
        <Boton ancho="completo" variante="secundaria" alTocar={cerrar} deshabilitado={enviando}>
          {textos.cancelar}
        </Boton>
      </Pila>
    </Superposicion>
  );
}
