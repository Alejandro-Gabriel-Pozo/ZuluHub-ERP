import estilos from "./FormularioDeAplicarConteo.module.css";

export type FilaAplicadaParaVer = Readonly<{
  articuloId: string;
  nombre: string;
  contado: string;
  diferencia: string;
  motivo: string | null;
  detalle: string | null;
}>;

/**
 * El resultado de un conteo aplicado (maqueta `stock-conteo.html`, FP-STK-12), solo lectura: por artículo, lo contado, la diferencia que quedó y su motivo (con el detalle si «otra»). El ajuste por conteo no se anula: se
 * corrige con otro conteo o con un ajuste. Los rótulos llegan resueltos.
 */
export function ListaDeConteoAplicado({
  titulo,
  filas,
  rotulos,
}: Readonly<{
  titulo: string | null;
  filas: readonly FilaAplicadaParaVer[];
  rotulos: Readonly<{ contado: string; diferencia: string; motivo: string }>;
}>) {
  return (
    <section>
      {titulo === null ? null : <h2>{titulo}</h2>}
      <ul className={estilos["filas"]}>
        {filas.map((f) => (
          <li key={f.articuloId} className={estilos["fila"]}>
            <strong className={estilos["nombre"]}>{f.nombre}</strong>
            <dl className={estilos["datos"]}>
              <div>
                <dt>{rotulos.contado}</dt>
                <dd>{f.contado}</dd>
              </div>
              <div>
                <dt>{rotulos.diferencia}</dt>
                <dd>{f.diferencia}</dd>
              </div>
              {f.motivo === null ? null : (
                <div>
                  <dt>{rotulos.motivo}</dt>
                  <dd>{f.detalle === null ? f.motivo : `${f.motivo}: ${f.detalle}`}</dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
