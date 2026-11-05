import estilos from "./HojaA4.module.css";
import type { FilaArmada, HojaArmada, RenglonArmado } from "./modelo-de-la-hoja";

/**
 * Las piezas de la hoja A4: el encabezado, la tabla de renglones y el pie. La hoja que se imprime y la tabla de medición usan LAS
 * MISMAS piezas con las mismas clases: así el alto que se mide es el alto que se dibuja (previene un renglón de alto distinto entre
 * lo medido y lo impreso, que desborda la hoja). Sin estado ni efectos: todo llega por props.
 */

const CLASE_DE_COLUMNA = {
  descripcion: undefined,
  cantidad: estilos["colCantidad"],
  precio: estilos["colPrecio"],
  iva: estilos["colIva"],
  importe: estilos["colImporte"],
} as const;

function Fila({ fila }: Readonly<{ fila: FilaArmada }>) {
  return (
    <div className={estilos["dato"]}>
      {fila.rotulo === null ? null : <span className={estilos["negrita"]}>{fila.rotulo} </span>}
      {fila.valor}
    </div>
  );
}

export function EncabezadoDeHoja({ a }: Readonly<{ a: HojaArmada }>) {
  return (
    <header className={estilos["encabezado"]} data-medida="encabezado">
      {a.leyendas.map((leyenda, i) => (
        <div key={i} className={estilos["homologacion"]}>
          {leyenda}
        </div>
      ))}
      {a.leyendasLegales.map((leyenda, i) => (
        <div key={i} className={estilos["leyendaLegal"]} data-leyenda-legal="">
          {leyenda}
        </div>
      ))}
      <div className={estilos["cabecera"]}>
        <div>
          {a.nombreDeFantasia === null ? null : (
            <div className={estilos["nombre"]}>{a.nombreDeFantasia}</div>
          )}
          {a.emisor.map((fila) => (
            <Fila key={fila.rotulo ?? fila.valor} fila={fila} />
          ))}
          {a.contacto === null ? null : <div className={estilos["dato"]}>{a.contacto}</div>}
        </div>
        <div className={estilos["letra"]}>
          <div className={estilos["letraGrande"]}>{a.letra}</div>
          <div className={estilos["codigo"]}>{a.codigo}</div>
        </div>
        <div>
          <div className={estilos["rotulo"]}>{a.rotulo}</div>
          <div className={estilos["numero"]}>{a.numero}</div>
          {a.datos.map((fila) => (
            <Fila key={fila.rotulo ?? fila.valor} fila={fila} />
          ))}
        </div>
      </div>
      {a.corresponde === null ? null : (
        <div className={estilos["corresponde"]}>{a.corresponde}</div>
      )}
      <div className={estilos["receptor"]}>
        {a.receptor.map((fila) => (
          <Fila key={fila.rotulo ?? fila.valor} fila={fila} />
        ))}
      </div>
    </header>
  );
}

export type PropsDeLaTabla = Readonly<{
  a: HojaArmada;
  renglones: readonly RenglonArmado[];
  /** El parcial de la hoja anterior, ya formateado; `null` en la primera hoja. */
  transporte: string | null;
  /** En la tabla de medición el «Transporte» va al final y se marca para medirlo. */
  paraMedir?: boolean;
}>;

export function TablaDeRenglones({ a, renglones, transporte, paraMedir = false }: PropsDeLaTabla) {
  const columnas = a.columnas;
  const filaDeTransporte = (
    <tr className={estilos["transporte"]} data-transporte="">
      <td colSpan={columnas.length - 1}>{a.rotuloDeTransporte}</td>
      <td className={estilos["numerica"]}>{transporte}</td>
    </tr>
  );
  return (
    <table className={estilos["tabla"]}>
      <colgroup>
        {columnas.map((c) => (
          <col key={c.clave} className={CLASE_DE_COLUMNA[c.clave]} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columnas.map((c) => (
            <th key={c.clave} className={c.numerica ? estilos["numerica"] : undefined}>
              {c.titulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {transporte !== null && !paraMedir ? filaDeTransporte : null}
        {renglones.map((r, i) => (
          // El índice es la clave: los renglones se imprimen en su orden y nunca se reordenan ni se quitan uno a uno.
          <tr key={i} data-fila="">
            {columnas.map((c) => {
              const valor =
                c.clave === "descripcion"
                  ? r.descripcion
                  : c.clave === "cantidad"
                    ? r.cantidad
                    : c.clave === "precio"
                      ? r.precio
                      : c.clave === "iva"
                        ? r.iva
                        : r.importe;
              return (
                <td key={c.clave} className={c.numerica ? estilos["numerica"] : undefined}>
                  {valor}
                </td>
              );
            })}
          </tr>
        ))}
        {paraMedir ? filaDeTransporte : null}
      </tbody>
    </table>
  );
}

/** El QR llega ya dibujado (SVG como texto): se muestra como imagen, nunca como HTML. */
export function Qr({ qrSvg, clase }: Readonly<{ qrSvg: string; clase?: string }>) {
  return (
    <img
      className={clase ?? estilos["qr"]}
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`}
      alt=""
      data-qr=""
    />
  );
}

export type PropsDelPie = Readonly<{
  a: HojaArmada;
  qrSvg: string;
  /** «Hoja 2 de 3». */
  hoja: string;
  /** Verdadero en la última hoja: dibuja el bloque final; si no, «A transportar» con este parcial (ya formateado). */
  aTransportar: string | null;
  /** El alto que el contenido pide en lugar del fijo: es el pie de la tabla de medición. */
  paraMedir?: boolean;
}>;

export function PieDeHoja({ a, qrSvg, hoja, aTransportar, paraMedir = false }: PropsDelPie) {
  const claseDelPie = paraMedir
    ? `${estilos["pie"]} ${estilos["pieMedido"]}`
    : (estilos["pie"] ?? "");
  return (
    <footer className={claseDelPie} data-medida={paraMedir ? "pie" : undefined} data-pie="">
      <div className={estilos["pieIzquierdo"]}>
        {aTransportar === null ? (
          <>
            {a.totales.map((t) => (
              <div
                key={t.rotulo + t.valor}
                className={`${estilos["fila"]} ${t.fuerte ? estilos["filaFuerte"] : ""}`}
              >
                <span>{t.rotulo}</span>
                <span>{t.valor}</span>
              </div>
            ))}
            {a.transparencia === null ? null : (
              <div className={estilos["transparencia"]} data-transparencia="">
                <div className={estilos["transparenciaTitulo"]}>{a.transparencia.titulo}</div>
                {a.transparencia.filas.map((f) => (
                  <div key={f.rotulo ?? f.valor} className={estilos["fila"]}>
                    <span>{f.rotulo}</span>
                    <span>{f.valor}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className={`${estilos["fila"]} ${estilos["negrita"]}`} data-a-transportar="">
            <span>{a.rotuloDeATransportar}</span>
            <span>{aTransportar}</span>
          </div>
        )}
        <div className={estilos["numeroDeHoja"]}>{hoja}</div>
      </div>
      <div className={estilos["pieDerecho"]}>
        <div>
          <span className={estilos["negrita"]}>{a.cae.rotulo} </span>
          {a.cae.valor}
        </div>
        <Qr qrSvg={qrSvg} />
      </div>
    </footer>
  );
}
