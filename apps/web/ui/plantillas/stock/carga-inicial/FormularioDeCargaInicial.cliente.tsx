"use client";

import { useRef, useState } from "react";
import type { CodigoDeStock } from "../../../../../../src/capacidades/experiencia/respuesta-de-stock";
import {
  REGLA_DE_CANTIDAD,
  REGLA_DE_COSTO_UNITARIO,
} from "../../../../../../src/capacidades/experiencia/reglas-de-cantidad";
import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../../componentes/Boton.cliente";
import { Campo } from "../../../componentes/Campo";
import { CampoNumero } from "../../../componentes/CampoNumero";
import { Selector } from "../../../componentes/Selector";
import { BotonDeEnvio } from "../../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../../patrones/FormularioDeAccion.cliente";
import { loteQueSePide, type OpcionDeArticulo } from "../movimientos/modelo-de-formularios";
import {
  errorDeLaFila,
  FILA_VACIA,
  opcionesParaLaFila,
  puedeRegistrar,
  resumenDeLaCarga,
  valorDeLaFila,
  type FilaDeCarga,
} from "./modelo-de-carga-inicial";
import estilos from "./FormularioDeCargaInicial.module.css";

/** El código con que la composición avisa «este depósito ya tiene existencia»: la pantalla muestra su texto y el próximo envío lo confirma con la misma clave. */
const CODIGO_DE_AVISO = "STOCK_YA_HAY_EXISTENCIA" satisfies CodigoDeStock;

type Opcion = Readonly<{ valor: string; etiqueta: string }>;

export type PropsDeFormularioDeCargaInicial = Readonly<{
  /** La acción de servidor con la clave de idempotencia ya ligada (`bind`): repetir el envío no duplica. */
  accion: AccionDeFormulario;
  depositos: readonly Opcion[];
  /** Cada artículo con cómo se controla por lote hoy (`null`: no se controla): con control, la fila pide «Lote» y «Vence». */
  articulos: readonly OpcionDeArticulo[];
  /** La unidad de stock de cada artículo (solo lectura), ya con su texto. */
  unidades: Readonly<Record<string, string>>;
  /** Adónde lleva «Cancelar». */
  hrefDeCancelar: string;
  /** Si la persona puede registrar la carga (el servidor igual decide). */
  puedeEnviar: boolean;
}>;

/**
 * La grilla de «Carga inicial» (maqueta `stock-carga-inicial.html`, FP-STK-08): un depósito para toda la tanda y una fila por artículo con cantidad, costo por unidad opcional y su valor; resumen de artículos y valor
 * total, aviso de que la carga es de hoy y, si hay filas sin costo, cuántas. Todo es ayuda: el servidor valida cada renglón y decide (todo o nada). «Registrar» sale apagado con una fila a medias. Los campos numéricos entregan
 * texto canónico (`CampoNumero`), nunca `number`. Un depósito con existencia previa se avisa y el próximo «Registrar» confirma con la misma clave; cambiar cualquier dato descarta esa confirmación.
 */
export function FormularioDeCargaInicial({
  accion,
  depositos,
  articulos,
  unidades,
  hrefDeCancelar,
  puedeEnviar,
}: PropsDeFormularioDeCargaInicial) {
  const [deposito, setDeposito] = useState(depositos[0]?.valor ?? "");
  const proxima = useRef(2);
  const [filas, setFilas] = useState<readonly FilaDeCarga[]>([
    { ...FILA_VACIA(1), articuloId: articulos[0]?.valor ?? "" },
  ]);
  const [avisado, setAvisado] = useState(false);

  /** Cambiar cualquier dato descarta la confirmación: lo que se confirma es lo que se vio. */
  const cambiaFilas = (nuevas: readonly FilaDeCarga[]) => {
    setAvisado(false);
    setFilas(nuevas);
  };
  const cambiaFila = (clave: number, cambio: Partial<FilaDeCarga>) =>
    cambiaFilas(filas.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));
  const agregar = () => {
    const libre = opcionesParaLaFila(articulos, filas, -1)[0];
    if (libre === undefined) return;
    cambiaFilas([...filas, { ...FILA_VACIA(proxima.current++), articuloId: libre.valor }]);
  };
  const quitar = (clave: number) => cambiaFilas(filas.filter((f) => f.clave !== clave));

  const conAviso: AccionDeFormulario = async (previo, datos) => {
    if (avisado) datos.set("confirmar", "1");
    // Cuando la acción sale bien, Next redirige y el pedido no devuelve valor: por eso `| undefined`.
    const resultado: Awaited<ReturnType<AccionDeFormulario>> | undefined = await accion(
      previo,
      datos,
    );
    setAvisado(resultado?.error?.codigo === CODIGO_DE_AVISO);
    return resultado;
  };

  const controles = Object.fromEntries(articulos.map((a) => [a.valor, a.controlDeLote]));
  const resumen = resumenDeLaCarga(filas, controles);
  const hayLibres = opcionesParaLaFila(articulos, filas, -1).length > 0;
  return (
    <FormularioDeAccion accion={conAviso}>
      <Selector
        dato="deposito-de-stock"
        etiqueta={texto({}, "stock.pantalla.depositos")}
        nombre="depositoId"
        valor={deposito}
        alCambiar={(v) => {
          setAvisado(false);
          setDeposito(v);
        }}
        opciones={depositos}
      />
      <ul className={estilos["filas"]}>
        {filas.map((fila, i) => {
          const error = errorDeLaFila(fila);
          const valor = valorDeLaFila(fila);
          const pideLote = loteQueSePide(controles[fila.articuloId] ?? null);
          return (
            <li key={fila.clave} className={estilos["fila"]}>
              <Selector
                dato="articulo-de-stock"
                etiqueta={texto({}, "stock.accion.articulo")}
                nombre={`articuloId.${i}`}
                valor={fila.articuloId}
                alCambiar={(v) => cambiaFila(fila.clave, { articuloId: v })}
                opciones={opcionesParaLaFila(articulos, filas, fila.clave)}
              />
              {pideLote === null ? null : (
                <Campo
                  dato="codigo-de-lote"
                  etiqueta={texto({}, "lotes.lote.lote")}
                  nombre={`loteCodigo.${i}`}
                  valor={fila.lote}
                  alCambiar={(v) => cambiaFila(fila.clave, { lote: v })}
                  autoComplete="off"
                />
              )}
              {pideLote?.vence === true ? (
                <Campo
                  dato="vencimiento-de-lote"
                  etiqueta={texto({}, "stock.lotes.vence")}
                  nombre={`loteVence.${i}`}
                  tipo="date"
                  valor={fila.vence}
                  alCambiar={(v) => cambiaFila(fila.clave, { vence: v })}
                />
              ) : null}
              <CampoNumero
                dato="cantidad-de-movimiento-de-stock"
                etiqueta={texto({}, "stock.accion.cantidad")}
                nombre={`cantidad.${i}`}
                valor={fila.cantidad}
                alCambiar={(v) => cambiaFila(fila.clave, { cantidad: v })}
                regla={REGLA_DE_CANTIDAD}
                error={
                  error === "CANTIDAD" ? texto({}, "stock.error.cantidad_invalida") : undefined
                }
              />
              <span className={estilos["unidad"]}>{unidades[fila.articuloId] ?? ""}</span>
              <CampoNumero
                dato="costo-por-unidad-de-entrada"
                etiqueta={texto({}, "stock.accion.costo_por_unidad")}
                ayuda={texto({}, "catalogo.campo.opcional")}
                nombre={`costoUnitario.${i}`}
                simbolo="$"
                valor={fila.costo}
                alCambiar={(v) => cambiaFila(fila.clave, { costo: v })}
                regla={REGLA_DE_COSTO_UNITARIO}
                error={error === "COSTO" ? texto({}, "stock.carga.revisar_costo") : undefined}
              />
              <p className={estilos["valor"]}>
                {texto({}, "stock.carga.valor")}
                {valor === null ? null : <strong> {valor}</strong>}
              </p>
              <Boton
                alTocar={() => quitar(fila.clave)}
                deshabilitado={filas.length === 1}
                variante="secundaria"
              >
                {texto({}, "catalogo.accion.quitar")}
              </Boton>
            </li>
          );
        })}
      </ul>
      <Boton alTocar={agregar} deshabilitado={!hayLibres} variante="secundaria">
        {texto({}, "stock.carga.agregar_articulo")}
      </Boton>
      <p className={estilos["resumen"]}>
        {texto({}, "stock.carga.resumen", {
          cantidad: String(resumen.articulos),
          total: resumen.total ?? "",
        })}
      </p>
      {resumen.sinCosto === 0 ? null : (
        <p>{texto({}, "stock.carga.sin_costo", { n: String(resumen.sinCosto) })}</p>
      )}
      <p>{texto({}, "stock.carga.es_de_hoy")}</p>
      <div className={estilos["acciones"]}>
        <a className={estilos["secundario"]} href={hrefDeCancelar}>
          {texto({}, "catalogo.accion.cancelar")}
        </a>
        {puedeEnviar && puedeRegistrar(deposito, filas, controles) ? (
          <BotonDeEnvio>{texto({}, "stock.accion.registrar")}</BotonDeEnvio>
        ) : (
          <Boton deshabilitado>{texto({}, "stock.accion.registrar")}</Boton>
        )}
      </div>
    </FormularioDeAccion>
  );
}
