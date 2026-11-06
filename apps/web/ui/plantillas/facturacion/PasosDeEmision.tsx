import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { CampoImporte } from "../../componentes/CampoImporte";
import { Selector } from "../../componentes/Selector";
import { Aviso } from "../../componentes/Aviso";
import estilos from "./PantallaDeEmitirFactura.module.css";
import {
  conDocumento,
  documentoElegidoDe,
  limpiarCantidad,
  type ClienteEscrito,
  type RenglonEscrito,
} from "./eleccion-de-emision";
import type { VistaDeLaRevision, VistaDeLosRenglones, VistaDelCliente } from "./modelo-de-emision";

/**
 * Lo que se ve en cada uno de los tres pasos de «Emitir una factura»: sin estado propio (lo guarda la pantalla), solo campos y la
 * revisión. Los textos llegan ya resueltos en la vista (`modelo-de-emision.ts`).
 */

/** Paso 1: el cliente. El consumidor final no pide nada más; con un documento, se pide su número, su nombre y su condición ante el IVA (D-24). */
export function PasoDelCliente({
  vista,
  cliente,
  alCambiar,
}: Readonly<{
  vista: VistaDelCliente;
  cliente: ClienteEscrito;
  alCambiar: (nuevo: ClienteEscrito) => void;
}>) {
  const { identificacion } = vista;
  return (
    <>
      <Selector
        dato="pendiente"
        etiqueta={vista.documento.etiqueta}
        valor={cliente.documento}
        opciones={vista.documento.opciones}
        alCambiar={(valor) => {
          const documento = documentoElegidoDe(valor);
          if (documento !== null) alCambiar(conDocumento(cliente, documento));
        }}
      />
      {identificacion === null ? null : (
        <>
          <Campo
            dato="pendiente"
            etiqueta={identificacion.numero}
            valor={cliente.numero}
            inputMode="numeric"
            autoComplete="off"
            alCambiar={(numero) => {
              alCambiar({ ...cliente, numero });
            }}
          />
          <Campo
            dato="pendiente"
            etiqueta={identificacion.nombre}
            valor={cliente.nombre}
            autoComplete="off"
            alCambiar={(nombre) => {
              alCambiar({ ...cliente, nombre });
            }}
          />
          <Selector
            dato="pendiente"
            etiqueta={identificacion.condicion.etiqueta}
            textoDeElegir={identificacion.condicion.etiqueta}
            valor={cliente.condicionIva}
            opciones={identificacion.condicion.opciones}
            alCambiar={(condicionIva) => {
              alCambiar({ ...cliente, condicionIva });
            }}
          />
        </>
      )}
    </>
  );
}

/** Paso 2: los renglones (al menos uno). Cada uno lleva descripción, cantidad, precio con IVA y, si la empresa discrimina IVA, la alícuota. */
export function PasoDeLosRenglones({
  vista,
  renglones,
  alCambiar,
  alAgregar,
  alQuitar,
}: Readonly<{
  vista: VistaDeLosRenglones;
  renglones: readonly RenglonEscrito[];
  alCambiar: (id: number, cambios: Partial<Omit<RenglonEscrito, "id">>) => void;
  alAgregar: () => void;
  alQuitar: (id: number) => void;
}>) {
  const { etiquetas } = vista;
  return (
    <>
      {renglones.map((r, i) => (
        <fieldset key={r.id} className={estilos["renglon"]}>
          <legend className={estilos["nombre"]}>{vista.grupo(i + 1)}</legend>
          <Campo
            dato="pendiente"
            etiqueta={etiquetas.descripcion}
            valor={r.descripcion}
            autoComplete="off"
            alCambiar={(descripcion) => {
              alCambiar(r.id, { descripcion });
            }}
          />
          <Campo
            dato="cantidad"
            etiqueta={etiquetas.cantidad}
            valor={r.cantidad}
            inputMode="decimal"
            autoComplete="off"
            alCambiar={(escrito) => {
              alCambiar(r.id, { cantidad: limpiarCantidad(escrito) });
            }}
          />
          <CampoImporte
            dato="importe"
            etiqueta={etiquetas.precio}
            valor={r.precio}
            alCambiar={(precio) => {
              alCambiar(r.id, { precio });
            }}
          />
          {etiquetas.iva === null ? null : (
            <Selector
              dato="pendiente"
              etiqueta={etiquetas.iva}
              textoDeElegir={etiquetas.iva}
              valor={r.alicuota}
              opciones={vista.alicuotas}
              alCambiar={(alicuota) => {
                alCambiar(r.id, { alicuota });
              }}
            />
          )}
          {renglones.length > 1 ? (
            <Boton
              ancho="completo"
              variante="secundaria"
              alTocar={() => {
                alQuitar(r.id);
              }}
            >
              {vista.quitar(i + 1)}
            </Boton>
          ) : null}
        </fieldset>
      ))}
      <Boton ancho="completo" variante="secundaria" alTocar={alAgregar}>
        {etiquetas.agregar}
      </Boton>
    </>
  );
}

/** Paso 3: el cliente, los renglones con el total y el punto de venta. Es la confirmación: no hay otra (contrato, pantalla 3). */
export function PasoDeRevisar({
  vista,
  puntoElegido,
  alElegirPunto,
  deshabilitado,
}: Readonly<{
  vista: VistaDeLaRevision;
  puntoElegido: string;
  alElegirPunto: (id: string) => void;
  deshabilitado: boolean;
}>) {
  const { cliente, renglones, puntoDeVenta } = vista;
  return (
    <>
      <h2 className={estilos["titulo"]}>{vista.titulo}</h2>
      <section className={estilos["tarjeta"]} aria-label={cliente.rotulo}>
        <p className={estilos["rotulo"]}>{cliente.rotulo}</p>
        <p className={estilos["dato"]}>{cliente.principal}</p>
        {cliente.secundario === null ? null : (
          <p className={estilos["suave"]}>{cliente.secundario}</p>
        )}
      </section>
      <section className={estilos["tarjeta"]} aria-label={renglones.rotulo}>
        <p className={estilos["rotulo"]}>{renglones.rotulo}</p>
        <dl className={estilos["filas"]}>
          {renglones.filas.map((fila) => (
            <div key={fila.id} className={estilos["fila"]}>
              <dt>
                <span className={estilos["descripcion"]}>{fila.descripcion}</span>
                <br />
                <span className={estilos["suave"]}>
                  {fila.iva === null ? fila.cuenta : `${fila.cuenta} · ${fila.iva}`}
                </span>
              </dt>
              <dd className={estilos["importe"]}>{fila.importe}</dd>
            </div>
          ))}
          <div className={estilos["fila"]} data-fuerte="true">
            <dt>{renglones.rotuloDelTotal}</dt>
            <dd className={estilos["importe"]}>{renglones.total}</dd>
          </div>
        </dl>
      </section>
      <section className={estilos["tarjeta"]} aria-label={puntoDeVenta.rotulo}>
        {puntoDeVenta.modo === "varios" ? (
          <Selector
            dato="pendiente"
            etiqueta={puntoDeVenta.rotulo}
            textoDeElegir={puntoDeVenta.rotulo}
            valor={puntoElegido}
            opciones={puntoDeVenta.opciones}
            deshabilitado={deshabilitado}
            alCambiar={alElegirPunto}
          />
        ) : (
          <>
            <p className={estilos["rotulo"]}>{puntoDeVenta.rotulo}</p>
            <p className={estilos["dato"]}>{puntoDeVenta.texto}</p>
          </>
        )}
        {puntoDeVenta.avisoDePruebas === null ? null : (
          <Aviso tono="aviso">{puntoDeVenta.avisoDePruebas}</Aviso>
        )}
      </section>
    </>
  );
}
