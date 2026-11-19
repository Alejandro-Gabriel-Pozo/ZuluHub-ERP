import { BloqueDeCaja, type AccionesDelServidorDeCaja } from "./BloqueDeCaja.cliente";
import type { AccionesDeLaPantallaDeCaja } from "./lista-de-caja";
import type { CajaDeLaPantalla } from "./modelo-de-la-caja";
import estilos from "./PantallaDeCaja.module.css";

export type PropsDePantallaDeCaja = Readonly<{
  cajas: readonly CajaDeLaPantalla[];
  permisos: AccionesDeLaPantallaDeCaja;
  acciones: AccionesDelServidorDeCaja;
}>;

/**
 * La pantalla «Caja» del mostrador (maqueta `caja.html`): un bloque por cada caja activa de la sucursal, cada uno con su propia caja (abrir manda su `cajaId`). Sin textos propios: los
 * resuelve cada bloque desde el catálogo.
 */
export function PantallaDeCaja({ cajas, permisos, acciones }: PropsDePantallaDeCaja) {
  return (
    <div className={estilos["raiz"]}>
      {cajas.map((caja) => (
        <BloqueDeCaja key={caja.cajaId} caja={caja} permisos={permisos} acciones={acciones} />
      ))}
    </div>
  );
}
