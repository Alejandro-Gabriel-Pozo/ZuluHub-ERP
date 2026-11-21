import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { BloqueDeCaja, type AccionesDelServidorDeCaja } from "./BloqueDeCaja.cliente";
import type { AccionesDeLaPantallaDeCaja } from "./lista-de-caja";
import type { CajaDeLaPantalla } from "./modelo-de-la-caja";
import type { ConteoDeLaCaja } from "./modelo-de-conteo-de-caja";
import estilos from "./PantallaDeCaja.module.css";

/** Una caja con lo que hay que contar si su sesión está en cierre (o por qué no se pudo leer). */
export type CajaParaDibujar = Readonly<{
  caja: CajaDeLaPantalla;
  conteo: ConteoDeLaCaja | null;
  errorDelConteo: ErrorPublico | null;
}>;

export type PropsDePantallaDeCaja = Readonly<{
  cajas: readonly CajaParaDibujar[];
  permisos: AccionesDeLaPantallaDeCaja;
  acciones: AccionesDelServidorDeCaja;
  largoMaximoDelTexto: number;
}>;

/**
 * La pantalla «Caja» del mostrador (maqueta `caja.html`): un bloque por cada caja activa de la sucursal, cada uno con su propia caja (abrir manda su `cajaId`; cada caja tiene su sesión).
 * Sin textos propios: los resuelve cada bloque desde el catálogo.
 */
export function PantallaDeCaja({
  cajas,
  permisos,
  acciones,
  largoMaximoDelTexto,
}: PropsDePantallaDeCaja) {
  return (
    <div className={estilos["raiz"]}>
      {cajas.map((c) => (
        <BloqueDeCaja
          key={c.caja.cajaId}
          caja={c.caja}
          conteo={c.conteo}
          errorDelConteo={c.errorDelConteo}
          permisos={permisos}
          acciones={acciones}
          largoMaximoDelTexto={largoMaximoDelTexto}
        />
      ))}
    </div>
  );
}
