import type { ReactNode } from "react";
import { Insignia } from "../../componentes/Insignia";
import estilos from "./PantallaDelSalon.module.css";
import type { MapaArmado } from "./modelo-del-mapa";

export type PropsDePantallaDelSalon = Readonly<{
  /** Lo que se muestra; `null` si no se pudo leer (entonces va `error`). */
  mapa: MapaArmado | null;
  /** El error ya pintado (la página lo arma con el catálogo y la referencia). */
  error?: ReactNode;
}>;

/**
 * El mapa de mesas del salón (SAL-A; maqueta `salon.html`, aprobada el 09/11/2026): los filtros y, debajo, una tarjeta por mesa de la sucursal con su estado (ícono y texto), su total y, si es el caso,
 * a qué mesa está unida o las cuentas en que está dividida. Sin estado ni hooks: es una página de servidor; los filtros son enlaces (recargan con `?filtro=`). Una mesa todavía no se toca (su ficha es SAL-B).
 * Sin textos propios: todos llegan resueltos. El `h1` lo pone el armazón.
 */
export function PantallaDelSalon({ mapa, error }: PropsDePantallaDelSalon) {
  return (
    <div className={estilos["raiz"]}>
      {error ?? null}
      {mapa === null ? null : (
        <>
          <ul className={estilos["filtros"]}>
            {mapa.filtros.map((f) => (
              <li key={f.valor}>
                <a
                  className={estilos["filtro"]}
                  href={f.href}
                  data-activo={f.activo ? "si" : "no"}
                  aria-current={f.activo ? "true" : undefined}
                >
                  {f.texto}
                </a>
              </li>
            ))}
          </ul>
          <ul className={estilos["lista"]} aria-label={mapa.etiqueta}>
            {mapa.filas.map((fila) => (
              <li key={fila.id} className={estilos["mesa"]}>
                <div className={estilos["cabecera"]}>
                  <span>{fila.titulo}</span>
                  {fila.estado === null ? null : (
                    <Insignia tono={fila.estado.tono}>{fila.estado.texto}</Insignia>
                  )}
                </div>
                {fila.total === null ? null : <p className={estilos["total"]}>{fila.total}</p>}
                {fila.cuentas.length === 0 ? null : (
                  <ul className={estilos["cuentas"]}>
                    {fila.cuentas.map((cuenta) => (
                      <li key={cuenta}>{cuenta}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
